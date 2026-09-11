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
    @Published var autoApproveCount = 0

    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutBuf = Data()

    // 백엔드 선택 — Electron 셸과 동일 2종. 로컬은 Next(3000)가 WS 를 프록시하지 못하므로
    // 백엔드(52416) 직결 (기존 bridgeBackendUrl 관행). label 은 다국어 키.
    static let backends: [(id: String, label: String, url: String, webUrl: String)] = [
        ("external", "backend.external", "https://chat.openmake.cc", "https://chat.openmake.cc"),
        ("local", "backend.local", "http://localhost:52416", "http://localhost:3000"),
    ]
    var backendId: String {
        get { UserDefaults.standard.string(forKey: "backend") ?? "external" }
        set { UserDefaults.standard.set(newValue, forKey: "backend") }
    }
    var backend: (id: String, label: String, url: String, webUrl: String) {
        Self.backends.first { $0.id == backendId } ?? Self.backends[0]
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
        p.arguments = [helperURL.path, "--server", backend.url]
        var env = ProcessInfo.processInfo.environment
        env["OMK_COMPANION_API_KEY"] = apiKey
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
            }
        }
        do { try p.run() } catch {
            statusText = L("status.helperLaunchFailed", error.localizedDescription)
            return false
        }
        process = p
        stdinPipe = inPipe
        return true
    }

    func stopHelper() {
        send(["cmd": "quit"])
        let p = process
        process = nil
        stdinPipe = nil
        connectedFolders = []
        rootStatus = [:]
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

    /** 백엔드 전환 — 헬퍼 재기동(서버 URL 은 spawn 인자) 후 재연결. */
    func switchBackend(_ id: String) {
        backendId = id
        let folders = connectedFolders.isEmpty ? lastFolders : connectedFolders
        stopHelper()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            for f in folders { self.connect(folder: f) }
        }
    }

    func openWeb() {
        if let url = URL(string: backend.webUrl) { NSWorkspace.shared.open(url) }
    }

    /** bridge 스코프 키 발급 페이지 — 설정 화면에서 아직 저장하지 않은 백엔드 선택도 따른다. */
    func openApiAccess(backendId id: String) {
        let web = Self.backends.first { $0.id == id }?.webUrl ?? backend.webUrl
        if let url = URL(string: "\(web)/api-access") { NSWorkspace.shared.open(url) }
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
            } else {
                statusText = text
                if code == "idle" { connectedFolders = []; rootStatus = [:] }
            }
        case "connected":
            if let f = ev["folder"] as? String, !connectedFolders.contains(f) { connectedFolders.append(f) }
        case "disconnected":
            if let f = ev["folder"] as? String {
                connectedFolders.removeAll { $0 == f }
                rootStatus[f] = nil
            }
        case "autoApprove":
            autoApproveCount = ev["count"] as? Int ?? 0
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
        taskId.map { "\(backend.webUrl)/agent-tasks?task=\($0)" } ?? backend.webUrl
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
