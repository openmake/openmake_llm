// HelperManager — Node 헬퍼(브리지 코어) 프로세스의 유일한 spawn 주체.
//
// 보안 설계 (plan §3·목표 원칙):
//  - 로컬 실행 권한의 범위는 항상 "사용자가 NSOpenPanel 로 직접 지정한 폴더 + 하위" —
//    경로 스코프 강제는 헬퍼(코어)의 realpath safe() 가 담당하고, 여기서는 발원만 담당한다.
//  - exec 승인/거절의 선택 주체는 항상 사용자(네이티브 다이얼로그, 비우회). 'all'(일괄 승인)
//    은 그 작업 한정이며 회수는 코어가 관리, 여기서는 카운트 표시·즉시 해제만 제공한다.
//  - API key 는 argv 가 아니라 env 로 전달(ps 노출 방지), 저장은 Keychain.
//  - 좀비 방지: 앱 종료 시 stdin 닫힘 → 헬퍼가 스스로 정리 종료(하네스 검증됨). 추가로
//    terminate() 를 명시 호출한다.
import AppKit
import Foundation
import UserNotifications

@MainActor
final class HelperManager: NSObject, ObservableObject {
    static let shared = HelperManager()

    @Published var statusText = L("status.idle")
    /** 연결된 루트들(realpath) — 루트당 독립 브리지 연결(파생 deviceId), 서버엔 별개 디바이스. */
    @Published var connectedFolders: [String] = []
    /** 루트별 최근 상태 텍스트 (연결됨/재연결 중/서버 오류 등). */
    @Published var rootStatus: [String: String] = [:]
    /**
     * 서버가 인증 사유(키 폐기·만료, 계정 비활성 등)로 닫아 긴 간격으로만 재시도 중인 루트. 설정 저장 때 키가 같아도
     * 바로 다시 연결하는 근거다 — 관리자가 키·계정을 되살린 뒤 사용자가 10분을 기다리지 않게.
     */
    private(set) var authClosedFolders: Set<String> = []
    @Published var autoApproveCount = 0
    /** 브라우저 제어권 — true 면 사용자가 넘겨받은 상태(에이전트의 브라우저 요청을 실행하지 않는다). */
    @Published var browserUserControl = false

    /** 로컬 브라우저 사용 허용(설정) — 켜면 헬퍼가 전용 프로필 Chrome 을 쓸 수 있다고 서버에 알린다. 기본 꺼짐. */
    var browserEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "browserEnabled") }
        set { UserDefaults.standard.set(newValue, forKey: "browserEnabled") }
    }

    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutBuf = Data()

    // 서버 주소 — 사용자가 설정에 넣는 주소 하나. 브라우저에서 쓰는 주소(또는 API 주소)를 그대로 넣으면
    // 헬퍼(코어 endpoints)가 서버에 포트를 물어 연결 주소와 웹 주소를 정한다. 종전엔 선택지 2개
    // (chat.openmake.cc / localhost:52416)를 코드에 박아 두어, 주소·포트가 다른 설치에는 연결할 수 없었다.
    static let defaultServer = "https://chat.openmake.cc"
    /** 종전 설정의 "로컬" 선택지가 가리키던 주소 — 최초 1회 옮길 때만 쓴다. */
    private static let legacyLocalServer = "http://localhost:52416"
    var serverAddress: String {
        get {
            if let s = UserDefaults.standard.string(forKey: "server"), !s.isEmpty { return s }
            return UserDefaults.standard.string(forKey: "backend") == "local" ? Self.legacyLocalServer : Self.defaultServer
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "server")
            UserDefaults.standard.removeObject(forKey: "backend")
        }
    }
    /** 헬퍼가 알려 준 웹 주소(웹에서 열기·알림 링크). 아직 모르면 넣은 주소를 쓴다. */
    @Published var resolvedWebUrl: String?
    var webUrl: String { resolvedWebUrl ?? serverAddress }

    /** 넣은 주소 → `방식://호스트[:포트]`. http(s) 주소가 아니면 nil. */
    static func normalizeServer(_ raw: String) -> String? {
        guard let u = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = u.host, !host.isEmpty else { return nil }
        let h = host.contains(":") ? "[\(host)]" : host // IPv6
        return u.port.map { "\(scheme)://\(h):\($0)" } ?? "\(scheme)://\(h)"
    }
    /** 암호화 없이(http) 이 Mac 밖의 서버로 가는 주소인가 — API key 가 평문으로 나간다. */
    static func isPlainRemoteHttp(_ raw: String) -> Bool {
        guard let u = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)), u.scheme?.lowercased() == "http",
              let host = u.host else { return false }
        return !["localhost", "127.0.0.1", "::1"].contains(host)
    }
    /** 마지막 연결 폴더들 — 재기동 시 자동 재연결용(로컬 UserDefaults, 서버 미전송).
        구 단일 키(lastFolder)는 최초 1회 마이그레이션한다. */
    var lastFolders: [String] {
        get {
            if let arr = UserDefaults.standard.stringArray(forKey: "lastFolders") { return arr }
            if let one = UserDefaults.standard.string(forKey: "lastFolder") { return [one] }
            return []
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "lastFolders")
            UserDefaults.standard.removeObject(forKey: "lastFolder")
        }
    }

    /** 헬퍼·코어 상태 코드 → 다국어 키. 코드가 없거나 모르는 값(auth_error 등)이면 원문을 그대로 쓴다. */
    private static let statusKeys: [String: String] = [
        "connecting": "status.connecting",
        "connected": "status.connected",
        "server_error": "status.serverError",
        "reconnecting": "status.reconnecting",
        "closed": "status.closed",
        "idle": "status.idle",
        "api_key_required": "status.apiKeyRequired",
        "folder_open_failed": "status.folderOpenFailed",
        // 서버가 인증 사유로 닫음(코어 AUTH_CLOSE_REASONS) — 코어는 긴 간격으로만 다시 시도한다
        "api_key_revoked": "status.auth.apiKeyRevoked",
        "api_key_invalid": "status.auth.apiKeyInvalid",
        "api_key_expired": "status.auth.apiKeyExpired",
        "api_key_inactive": "status.auth.apiKeyInactive",
        "account_disabled": "status.auth.accountDisabled",
        "account_deleted": "status.auth.accountDeleted",
        "bridge_scope_required": "status.auth.scopeRequired",
    ]

    // ── 헬퍼 프로세스 lifecycle ──

    private func resourceURL(_ name: String) -> URL? {
        // 번들 실행(정식) → Resources, 개발 실행(swift run) → env 훅으로 경로 주입.
        if let env = ProcessInfo.processInfo.environment["OMK_COMPANION_\(name.uppercased())"] {
            return URL(fileURLWithPath: env)
        }
        return Bundle.main.resourceURL?.appendingPathComponent(name)
    }

    private func ensureHelper() -> Bool {
        if let p = process, p.isRunning { return true }
        // 테스트 훅(개발/E2E 전용): env key 가 있으면 Keychain 대신 사용 — Electron 의
        // OMK_BRIDGE_TOKEN 관행과 동일 계열. 정식 실행 경로는 Keychain 만 쓴다.
        let envKey = ProcessInfo.processInfo.environment["OMK_COMPANION_API_KEY"]
        guard let apiKey = envKey ?? Keychain.load(), !apiKey.isEmpty else {
            statusText = L("status.apiKeyRequired")
            return false
        }
        guard let nodeURL = resourceURL("node"), FileManager.default.isExecutableFile(atPath: nodeURL.path),
              let helperURL = resourceURL("helper.cjs"), FileManager.default.fileExists(atPath: helperURL.path) else {
            statusText = L("status.helperMissing")
            return false
        }
        let p = Process()
        p.executableURL = nodeURL
        p.arguments = [helperURL.path, "--server", serverAddress]
        var env = ProcessInfo.processInfo.environment
        // 키는 환경으로 넘기지 않는다 — 프로세스 시작 환경은 같은 사용자의 다른 프로세스가 읽을 수 있어,
        // 샌드박스 안의 승인된 명령이 헬퍼의 키를 읽어 낼 수 있었다. 기동 직후 stdin 으로 준다(아래 auth).
        env.removeValue(forKey: "OMK_COMPANION_API_KEY")
        if browserEnabled { env["OMK_COMPANION_BROWSER"] = "1" } else { env.removeValue(forKey: "OMK_COMPANION_BROWSER") }
        p.environment = env
        let inPipe = Pipe(), outPipe = Pipe()
        p.standardInput = inPipe
        p.standardOutput = outPipe
        p.standardError = FileHandle.nullDevice
        outPipe.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard !d.isEmpty else { return }
            Task { @MainActor in self?.consume(d) }
        }
        p.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                self?.process = nil
                self?.stdinPipe = nil
                if !(self?.connectedFolders.isEmpty ?? true) { self?.statusText = L("status.helperExited") }
                self?.connectedFolders = []
                self?.rootStatus = [:]
                self?.authClosedFolders = []
            }
        }
        do { try p.run() } catch {
            statusText = L("status.helperLaunchFailed", error.localizedDescription)
            return false
        }
        process = p
        stdinPipe = inPipe
        send(["cmd": "auth", "apiKey": apiKey])
        return true
    }

    func stopHelper() {
        send(["cmd": "quit"])
        let p = process
        process = nil
        stdinPipe = nil
        connectedFolders = []
        rootStatus = [:]
        authClosedFolders = []
        // quit 처리(결과 flush 100ms) 뒤에도 살아 있으면 강제 종료 — 좀비 방지 2중선.
        DispatchQueue.global().asyncAfter(deadline: .now() + 1.0) { if let p, p.isRunning { p.terminate() } }
    }

    private func send(_ obj: [String: Any]) {
        guard let pipe = stdinPipe,
              let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        pipe.fileHandleForWriting.write(data)
        pipe.fileHandleForWriting.write(Data("\n".utf8))
    }

    // ── 사용자 액션 ──

    /** 폴더 연결 — 권한 부여의 유일한 발원: 사용자가 패널에서 직접 고른 폴더만 헬퍼로 전달된다. */
    func chooseFolderAndConnect() {
        let panel = NSOpenPanel()
        panel.title = L("panel.title")
        panel.message = L("panel.message")
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        connect(folder: url.path)
    }

    func connect(folder: String) {
        guard ensureHelper() else { return }
        var l = lastFolders
        if !l.contains(folder) { l.append(folder) }
        lastFolders = l
        send(["cmd": "connect", "folder": folder])
    }

    func reconnectIfPossible() {
        // 테스트 훅(개발/E2E 전용): 폴더가 env 로 지정되면 패널 없이 자동 연결
        // (Electron 의 OMK_BRIDGE_FOLDER 와 동일 계열).
        if let f = ProcessInfo.processInfo.environment["OMK_COMPANION_FOLDER"] { connect(folder: f); return }
        guard Keychain.load() != nil else { return }
        for f in lastFolders { connect(folder: f) }
    }

    /** 루트 개별 해제 — 자동 재연결 목록에서도 제거한다. */
    func disconnect(folder: String) {
        send(["cmd": "disconnect", "folder": folder])
        lastFolders = lastFolders.filter { $0 != folder && !folder.hasSuffix($0) && !$0.hasSuffix(folder) }
        connectedFolders.removeAll { $0 == folder }
        rootStatus[folder] = nil
    }

    func disconnectAll() {
        send(["cmd": "disconnect"])
        lastFolders = []
        connectedFolders = []
        rootStatus = [:]
    }

    func clearAutoApprove() { send(["cmd": "clearAutoApprove"]) }

    /** 브라우저 제어권 전환 — 넘겨받으면 에이전트 입력이 멈추고, 돌려주면 에이전트가 현재 화면을 다시 읽는다. */
    func setBrowserUserControl(_ user: Bool) { send(["cmd": "browserControl", "user": user]) }
    /** 실행 중인 브라우저 작업 즉시 중지. */
    func stopBrowser() { send(["cmd": "browserStop"]) }

    /** 브라우저 사용 허용 변경 — 헬퍼 재기동(spawn env)으로 반영하고 연결을 되살린다. */
    func setBrowserEnabled(_ on: Bool) {
        guard on != browserEnabled else { return }
        browserEnabled = on
        browserUserControl = false
        let folders = connectedFolders.isEmpty ? lastFolders : connectedFolders
        stopHelper()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            for f in folders { self.connect(folder: f) }
        }
    }

    /** API key 변경 — 헬퍼 재기동(key 는 spawn env)으로 반영하고 연결을 되살린다. 키 폐기·만료로 멈춘 연결도 새 키로 다시 붙는다. */
    func reloadApiKey() {
        let folders = connectedFolders.isEmpty ? lastFolders : connectedFolders
        stopHelper()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            for f in folders { self.connect(folder: f) }
        }
    }

    /** 서버 주소 변경 — 헬퍼 재기동(주소는 spawn 인자) 후 재연결. 웹 주소는 새 헬퍼가 다시 알려 준다. */
    func switchServer(_ address: String) {
        serverAddress = address
        resolvedWebUrl = nil
        let folders = connectedFolders.isEmpty ? lastFolders : connectedFolders
        stopHelper()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            for f in folders { self.connect(folder: f) }
        }
    }

    func openWeb() {
        Task { if let url = URL(string: await webUrl(for: serverAddress)) { NSWorkspace.shared.open(url) } }
    }

    /** bridge 스코프 키 발급 페이지 — 설정 화면에서 아직 저장하지 않은 주소도 따른다(키를 넣기 전이라 헬퍼가 떠 있지 않다). */
    func openApiAccess(server: String) {
        Task { if let url = URL(string: "\(await webUrl(for: server))/api-access") { NSWorkspace.shared.open(url) } }
    }

    /** 이 서버 주소의 웹 주소 — 떠 있는 헬퍼가 이미 알려 줬으면 그것을, 아니면 헬퍼를 조회 전용(`--resolve`)으로 잠깐 돌려 묻는다.
        실패하면 넣은 주소를 그대로 쓴다. */
    func webUrl(for server: String) async -> String {
        if server == serverAddress, let known = resolvedWebUrl { return known }
        guard let nodeURL = resourceURL("node"), let helperURL = resourceURL("helper.cjs") else { return server }
        let resolved: String = await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                let p = Process()
                p.executableURL = nodeURL
                p.arguments = [helperURL.path, "--server", server, "--resolve"]
                let out = Pipe()
                p.standardOutput = out
                p.standardError = FileHandle.nullDevice
                p.standardInput = FileHandle.nullDevice
                var result = server
                if (try? p.run()) != nil {
                    let data = out.fileHandleForReading.readDataToEndOfFile()
                    p.waitUntilExit()
                    if let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let w = o["webUrl"] as? String { result = w }
                }
                cont.resume(returning: result)
            }
        }
        if server == serverAddress { resolvedWebUrl = resolved }
        return resolved
    }

    // ── 헬퍼 이벤트 소비 ──

    private func consume(_ d: Data) {
        stdoutBuf.append(d)
        while let nl = stdoutBuf.firstIndex(of: 0x0A) {
            let line = stdoutBuf.subdata(in: stdoutBuf.startIndex..<nl)
            stdoutBuf.removeSubrange(stdoutBuf.startIndex...nl)
            guard let ev = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  let kind = ev["ev"] as? String else { continue }
            handle(kind, ev)
        }
    }

    private func handle(_ kind: String, _ ev: [String: Any]) {
        switch kind {
        case "status":
            let code = ev["code"] as? String
            let text = Self.statusText(code: code, arg: ev["arg"] as? String, fallback: ev["text"] as? String ?? "")
            if let f = ev["folder"] as? String {
                rootStatus[f] = text // 루트별 상태 (연결됨/재연결 중/서버 오류)
                if Self.isAuthClosed(code) { authClosedFolders.insert(f) } else { authClosedFolders.remove(f) }
            } else {
                statusText = text
                if code == "idle" { connectedFolders = []; rootStatus = [:]; authClosedFolders = [] }
            }
        case "connected":
            if let f = ev["folder"] as? String, !connectedFolders.contains(f) { connectedFolders.append(f) }
        case "disconnected":
            if let f = ev["folder"] as? String {
                connectedFolders.removeAll { $0 == f }
                rootStatus[f] = nil
                authClosedFolders.remove(f)
            }
        case "autoApprove":
            autoApproveCount = ev["count"] as? Int ?? 0
        case "endpoints":
            if let w = ev["webUrl"] as? String { resolvedWebUrl = w }
        case "browserControl":
            browserUserControl = ev["user"] as? Bool ?? false
        case "confirm":
            presentConfirm(ev)
        case "taskEnd":
            notifyTaskEnd(taskId: ev["taskId"] as? String)
        case "approvalPending":
            if let taskId = ev["taskId"] as? String {
                notifyApprovalPending(taskId: taskId, toolName: ev["toolName"] as? String ?? "")
            }
        default:
            break
        }
    }

    /** 인증 사유로 닫힘을 뜻하는 상태 코드인가 — 문구 키가 status.auth.* 인 코드(코어 AUTH_CLOSE_REASONS). */
    static func isAuthClosed(_ code: String?) -> Bool {
        guard let code, let key = statusKeys[code] else { return false }
        return key.hasPrefix("status.auth.")
    }

    private static func statusText(code: String?, arg: String?, fallback: String) -> String {
        guard let code, let key = statusKeys[code] else { return fallback }
        return L(key, arg ?? "")
    }

    /** exec 승인 — 비우회 네이티브 다이얼로그. 실행될 명령 원문·실행 폴더를 그대로 보여준다. */
    private func presentConfirm(_ ev: [String: Any]) {
        let id = ev["id"] as? Int ?? 0
        let command = ev["command"] as? String ?? ""
        let taskId = ev["taskId"] as? String
        let base = ev["base"] as? String ?? ev["folder"] as? String ?? ""
        let sandboxed = ev["sandbox"] as? Bool ?? false
        let preview = command.count > 800 ? String(command.prefix(800)) + "…" : command

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = L("confirm.title")
        var detail = "\(preview)\n\n\(L("confirm.folder", base))\n"
        detail += sandboxed ? L("confirm.sandboxOn") : L("confirm.sandboxOff")
        if taskId != nil {
            detail += "\n\n" + L("confirm.allHint")
        }
        alert.informativeText = detail
        alert.addButton(withTitle: L("confirm.run"))
        if taskId != nil { alert.addButton(withTitle: L("confirm.runAll")) }
        alert.addButton(withTitle: L("confirm.deny"))
        NSApp.activate(ignoringOtherApps: true)
        let r = alert.runModal()
        let result: String
        if r == .alertFirstButtonReturn { result = "yes" }
        else if taskId != nil && r == .alertSecondButtonReturn { result = "all" }
        else { result = "no" }
        send(["cmd": "confirm", "id": id, "result": result])
    }

    /** 웹 작업 상세 딥링크 계약: /agent-tasks?task=<id> (admin/conversations 와 동일 패턴). */
    private func taskUrl(_ taskId: String?) -> String {
        taskId.map { "\(webUrl)/agent-tasks?task=\($0)" } ?? webUrl
    }

    /** 작업 종료 알림 — 클릭 시 웹 작업 상세로 핸드오프(상세 UI 는 웹 단일 구현 원칙).
        남아 있던 그 작업의 승인 대기 알림은 거둔다(이미 끝난 작업의 승인을 누르러 가지 않게). */
    private func notifyTaskEnd(taskId: String?) {
        let content = UNMutableNotificationContent()
        content.title = L("notify.taskEnd.title")
        content.body = L("notify.taskEnd.body")
        content.userInfo = ["url": taskUrl(taskId)]
        let center = UNUserNotificationCenter.current()
        if let taskId { center.removeDeliveredNotifications(withIdentifiers: ["approval-\(taskId)"]) }
        let req = UNNotificationRequest(identifier: taskId ?? UUID().uuidString, content: content, trigger: nil)
        center.add(req) { _ in /* 권한 거부 등은 무시(fail-open) */ }
    }

    /** 승인 대기·질문 알림 — 서버가 브리지 bridge_notice 로 알려 준다(2026-09-11 설계 변경).
        종전엔 "웹 푸시가 담당 — 중복 구현 안 함" 이었으나, 웹 푸시는 설정에서 켜야 하는 opt-in 이라
        운영 구독 0건 = 실제 도달 0 이었다. 로컬 작업을 돌리는 동안 이 앱은 항상 떠 있으므로 여기서
        직접 띄운다. 웹 푸시도 켠 사용자는 두 번 받을 수 있으나 놓치는 것보다 낫다.
        식별자를 작업 단위로 고정해 다중 루트·연속 승인에서도 쌓이지 않고 최신 1건으로 교체된다. */
    private func notifyApprovalPending(taskId: String, toolName: String) {
        let content = UNMutableNotificationContent()
        let isQuestion = toolName == "ask_human"
        content.title = isQuestion ? L("notify.question.title") : L("notify.approval.title")
        content.body = isQuestion ? L("notify.question.body") : L("notify.approval.body", toolName)
        content.sound = .default
        content.userInfo = ["url": taskUrl(taskId)]
        let req = UNNotificationRequest(identifier: "approval-\(taskId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req) { _ in /* 권한 거부 등은 무시(fail-open) */ }
    }
}
