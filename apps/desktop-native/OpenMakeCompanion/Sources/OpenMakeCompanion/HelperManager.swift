// HelperManager — 브리지 호스트(Rust `omk-ffi`, 같은 프로세스 안 — PR-3.2)의 유일한 시작 주체.
//
// 보안 설계 (plan §3·목표 원칙):
//  - 로컬 실행 권한의 범위는 항상 "사용자가 NSOpenPanel 로 직접 지정한 폴더 + 하위" —
//    경로 스코프 강제는 호스트(코어)의 realpath safe() 가 담당하고, 여기서는 발원만 담당한다.
//  - exec 승인/거절의 선택 주체는 항상 사용자(네이티브 다이얼로그, 비우회). 'all'(일괄 승인)
//    은 그 작업 한정이며 회수는 코어가 관리, 여기서는 카운트 표시·즉시 해제만 제공한다.
//  - API key 는 BridgeHost.start 의 인자로만 전달(설정 struct·환경·로그에 넣지 않는다), 저장은 Keychain.
//  - 정리: 호스트는 종료 때 자기가 띄운 Chrome·exec 자식을 정리한 뒤 exited 를 낸다(최악 약 9초). 같은 프로세스라
//    앱이 먼저 끝나면 정리가 끊기므로 앱 종료·업데이트는 exited 를 기다린다(applicationShouldTerminate·stopHostAndWait).
import AppKit
import Foundation
import OmkFfi
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
    /**
     * 헬퍼가 지원 폴더 잠금을 못 잡아 끝났다(다른 OpenMake 데스크톱 앱이 실행 중이거나 잠금 실패). 사용자가 "다시 시도" 를 누를 때까지
     * 헬퍼를 다시 띄우지 않는다 — 어느 앱을 남길지는 사용자가 고른다(앱은 스스로 끝내지 않는다).
     */
    @Published private(set) var instanceBlocked = false
    /** 브라우저 제어권 — true 면 사용자가 넘겨받은 상태(에이전트의 브라우저 요청을 실행하지 않는다). */
    @Published var browserUserControl = false

    /** 로컬 브라우저 사용 허용(설정) — 켜면 헬퍼가 전용 프로필 Chrome 을 쓸 수 있다고 서버에 알린다. 기본 꺼짐. */
    var browserEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "browserEnabled") }
        set { UserDefaults.standard.set(newValue, forKey: "browserEnabled") }
    }

    private var host: BridgeHostProtocol?
    /** 호스트 시작 — 시험이 가짜 호스트로 바꾼다. */
    var startHost: @MainActor (HostConfig, String, HostListener) throws -> BridgeHostProtocol = {
        try BridgeHost.start(config: $0, apiKey: $1, listener: $2)
    }
    /** exec 승인 창 띄우기 — 시험이 바꾼다. */
    var showConfirm: @MainActor (NSAlert) -> NSApplication.ModalResponse = {
        NSApp.activate(ignoringOtherApps: true)
        return $0.runModal()
    }
    /** 호스트 세대 — 시작마다 +1. 옛 세대의 이벤트는 relay 가 거른다(exited 만 통과). */
    private var hostGeneration = 0
    /** exited 를 아직 내지 않은 호스트들의 세대(지금 것 + 끄는 중인 것) — 앱 종료는 이것이 빌 때까지, 재기동은 끈 세대가 빠질 때까지 기다린다. */
    private var liveGenerations: Set<Int> = []
    /** 재기동 세대 — 대기 중 재기동이 또 예약되면 마지막 것만 연결한다. */
    private var restartGeneration = 0
    /** 앱 종료·업데이트 정리 중 — 새 호스트를 띄우지 않는다(폴더 연결·다시 시도·재기동). 업데이트 교체 실패로 앱을 계속 쓸 때만
        푼다(Astra r1 M-1). */
    private var terminating = false
    /** 끄는 호스트를 기다리는 상한 — 호스트 종료의 최악(Chrome 정리 포함 약 8.6초) + 여유. 같은 프로세스라 강제 종료가 없다. */
    static let hostStopLimit: TimeInterval = 12

    // 서버 주소 — 사용자가 설정에 넣는 주소 하나. 브라우저에서 쓰는 주소(또는 API 주소)를 그대로 넣으면
    // 헬퍼(코어 endpoints)가 서버에 포트를 물어 연결 주소와 웹 주소를 정한다. 종전엔 선택지 2개
    // (운영 주소 / localhost:52416)를 코드에 박아 두어, 주소·포트가 다른 설치에는 연결할 수 없었다.
    static let defaultServer = "http://localhost:52416"   // 설치 주소는 설정에서 입력한다
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
        // 헬퍼 지원 폴더 잠금(한 PC 한 헬퍼) — 못 잡으면 헬퍼가 연결하지 않고 끝난다
        "instance_conflict": "status.instance_conflict",
        "instance_lock_failed": "status.instance_lock_failed",
        // 서버가 인증 사유로 닫음(코어 AUTH_CLOSE_REASONS) — 코어는 긴 간격으로만 다시 시도한다
        "api_key_revoked": "status.auth.apiKeyRevoked",
        "api_key_invalid": "status.auth.apiKeyInvalid",
        "api_key_expired": "status.auth.apiKeyExpired",
        "api_key_inactive": "status.auth.apiKeyInactive",
        "account_disabled": "status.auth.accountDisabled",
        "account_deleted": "status.auth.accountDeleted",
        "bridge_scope_required": "status.auth.scopeRequired",
        // 같은 기기 id 로 다른 앱이 이미 연결돼 있어 서버가 거절함(코어 DEVICE_CONFLICT_REASON) — 코어는 1분 간격으로 다시 시도한다
        "device_conflict": "status.deviceConflict",
    ]

    // ── 호스트 lifecycle ──

    private func ensureHelper() -> Bool {
        if host != nil { return true }
        if terminating { return false }
        if instanceBlocked { return false } // 상태 문구(충돌·잠금 실패)를 그대로 둔다
        // 테스트 훅(개발/E2E 전용): env key 가 있으면 Keychain 대신 사용 — Electron 의
        // OMK_BRIDGE_TOKEN 관행과 동일 계열. ProcessSetup 이 기동 첫 줄에서 읽고 환경에서 지웠다(D-229).
        // 정식 실행 경로는 Keychain 만 쓴다.
        guard let apiKey = ProcessSetup.devApiKey ?? Keychain.load(), !apiKey.isEmpty else {
            statusText = L("status.apiKeyRequired")
            return false
        }
        hostGeneration += 1
        let generation = hostGeneration
        let relay = HostEventRelay(
            generation: generation,
            current: { [weak self] in self?.hostGeneration ?? -1 },
            onEvent: { [weak self] e in self?.handle(e) },
            onExited: { [weak self] g, _ in self?.hostExited(generation: g) })
        do {
            host = try startHost(HostConfig(server: serverAddress, browserEnabled: browserEnabled), apiKey, relay)
        } catch HostStartError.ApiKeyRequired {
            statusText = L("status.apiKeyRequired")
            return false
        } catch {
            statusText = L("status.helperLaunchFailed", error.localizedDescription)
            return false
        }
        liveGenerations.insert(generation)
        return true
    }

    /** 호스트가 끝났다(exited — 언제나 마지막 이벤트). 지금의 호스트가 스스로 끝났을 때만 상태를 지운다 — 끄는 중이던 옛 호스트가
        늦게 끝나도 새 호스트의 상태를 지우지 않게. */
    private func hostExited(generation: Int) {
        liveGenerations.remove(generation)
        guard generation == hostGeneration, host != nil else { return }
        host = nil
        if !connectedFolders.isEmpty { statusText = L("status.helperExited") }
        connectedFolders = []
        rootStatus = [:]
        authClosedFolders = []
    }

    /** 끝나지 않은 호스트가 있는가(끄는 중 포함) — 앱 종료가 기다릴지 정한다. */
    var hasLiveHost: Bool { !liveGenerations.isEmpty }

    func stopHelper() {
        try? host?.shutdown()
        host = nil // 놓으면 입력 끝과 같다 — 이미 quit 했으므로 두 번째 계기는 무시된다
        connectedFolders = []
        rootStatus = [:]
        authClosedFolders = []
    }

    /** 호스트를 끄고 모든 호스트의 exited 를 기다린다(상한 hostStopLimit) — 앱 종료·업데이트 교체 전(D-233). 예약된 재기동은
        무효로 하고 새 호스트를 막는다 — 대기 중 새 호스트가 뜨면 정리 없이 끝나거나 상한까지 기다린다(Astra r1 M-1). */
    func stopHostAndWait() async {
        terminating = true
        restartGeneration += 1
        stopHelper()
        await waitForHostsToExit(retiring: nil, restart: nil)
    }

    /** 끄는 호스트들이 끝날 때까지 100ms 간격(상한). retiring 이 있으면 그 세대들만 기다린다 — 그 뒤에 새로 뜬 호스트(폴더
        연결·다시 시도)는 기다리지 않는다(리뷰 r1 Low-1). 없으면 전부. restart 가 있으면 그 사이 새 재기동이 예약됐는지 본다. */
    private func waitForHostsToExit(retiring: Set<Int>?, restart: Int?) async {
        await Self.waitUntilExited(retiring, live: { self.liveGenerations }, limit: Self.hostStopLimit,
                                   cancelled: { restart.map { $0 != self.restartGeneration } ?? false })
    }

    /** `retiring` 세대들(nil 이면 살아 있는 전부)이 `live` 에서 빠질 때까지 100ms 간격으로 기다린다(상한 `limit`). */
    static func waitUntilExited(_ retiring: Set<Int>?, live: () -> Set<Int>, limit: TimeInterval,
                                cancelled: () -> Bool = { false }) async {
        let deadline = Date().addingTimeInterval(limit)
        while Date() < deadline {
            let l = live()
            if retiring.map({ l.isDisjoint(with: $0) }) ?? l.isEmpty { return }
            if cancelled() { return }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    /** 호스트 재기동 — 옛 호스트(와 그가 띄운 Chrome)가 실제로 끝난 뒤 새 호스트로 폴더를 다시 연결한다. 상한을 넘기면 그냥 새
        호스트를 띄운다 — 옛 호스트가 아직 잠금을 쥐었으면 새 호스트가 잠금을 15초 기다린다(D-234). */
    private func restartHelper() {
        let folders = connectedFolders.isEmpty ? lastFolders : connectedFolders
        stopHelper()
        let retiring = liveGenerations // 끈 순간에 잡는다 — Task 가 돌기 전에 뜬 새 세대가 섞이지 않게(리뷰 r2 Nit-1)
        restartGeneration += 1
        let generation = restartGeneration
        Task { @MainActor in
            await self.waitForHostsToExit(retiring: retiring, restart: generation)
            guard generation == self.restartGeneration else { return }
            for f in folders { self.connect(folder: f) }
        }
    }

    /** 업데이트 교체 스크립트를 띄우지 못했다 — 앱이 끝나지 않으므로 끈 호스트를 되살린다(D-233(r2)). */
    func restartAfterUpdateFailure() {
        terminating = false
        restartHelper()
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
        try? host?.connect(folder: folder)
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
        try? host?.disconnect(folder: folder)
        lastFolders = lastFolders.filter { $0 != folder && !folder.hasSuffix($0) && !$0.hasSuffix(folder) }
        connectedFolders.removeAll { $0 == folder }
        rootStatus[folder] = nil
    }

    func disconnectAll() {
        try? host?.disconnect(folder: nil)
        lastFolders = []
        connectedFolders = []
        rootStatus = [:]
    }

    /** 잠금 충돌·실패 뒤 "다시 시도" — 막힘을 풀고 마지막 폴더들로 헬퍼를 다시 띄운다(폴더가 없으면 헬퍼만 띄워 잠금을 다시 본다). */
    func retryInstance() {
        instanceBlocked = false
        statusText = L("status.idle")
        let folders = lastFolders
        if folders.isEmpty { _ = ensureHelper() } else { for f in folders { connect(folder: f) } }
    }

    func clearAutoApprove() { try? host?.clearAutoApprove() }

    /** 브라우저 제어권 전환 — 넘겨받으면 에이전트 입력이 멈추고, 돌려주면 에이전트가 현재 화면을 다시 읽는다. */
    func setBrowserUserControl(_ user: Bool) { try? host?.setBrowserUserControl(user: user) }
    /** 실행 중인 브라우저 작업 즉시 중지. */
    func stopBrowser() { try? host?.stopBrowser() }

    /** 브라우저 사용 허용 변경 — 호스트 재기동(시작 설정)으로 반영하고 연결을 되살린다. */
    func setBrowserEnabled(_ on: Bool) {
        guard on != browserEnabled else { return }
        browserEnabled = on
        browserUserControl = false
        restartHelper()
    }

    /** API key 변경 — 호스트 재기동(키는 시작 인자)으로 반영하고 연결을 되살린다. 키 폐기·만료로 멈춘 연결도 새 키로 다시 붙는다. */
    func reloadApiKey() {
        restartHelper()
    }

    /** 서버 주소 변경 — 호스트 재기동(주소는 시작 설정) 후 재연결. 웹 주소는 새 호스트가 다시 알려 준다. */
    func switchServer(_ address: String) {
        serverAddress = address
        resolvedWebUrl = nil
        restartHelper()
    }

    func openWeb() {
        Task { if let url = URL(string: await webUrl(for: serverAddress)) { NSWorkspace.shared.open(url) } }
    }

    /** bridge 스코프 키 발급 페이지 — 설정 화면에서 아직 저장하지 않은 주소도 따른다(키를 넣기 전이라 헬퍼가 떠 있지 않다). */
    func openApiAccess(server: String) {
        Task { if let url = URL(string: "\(await webUrl(for: server))/api-access") { NSWorkspace.shared.open(url) } }
    }

    /** 이 서버 주소의 웹 주소 — 떠 있는 호스트가 이미 알려 줬으면 그것을, 아니면 주소 찾기(resolveEndpoints, 블로킹 — 백그라운드
        큐)로 묻는다. 실패하면 넣은 주소를 그대로 쓴다. */
    func webUrl(for server: String) async -> String {
        if server == serverAddress, let known = resolvedWebUrl { return known }
        let resolved: String = await withCheckedContinuation { cont in
            DispatchQueue.global(qos: .userInitiated).async {
                cont.resume(returning: (try? resolveEndpoints(server: server))?.webUrl ?? server)
            }
        }
        if server == serverAddress { resolvedWebUrl = resolved }
        return resolved
    }

    // ── 호스트 이벤트 소비 ──

    private func handle(_ e: HostEvent) {
        switch e {
        case let .status(folder, text, code, rawArg):
            var arg = rawArg
            if code == "instance_conflict" || code == "instance_lock_failed" {
                instanceBlocked = true
                arg = arg.map(Self.appPath)
            }
            let shown = Self.statusText(code: code, arg: arg, fallback: text)
            if let f = folder {
                rootStatus[f] = shown // 루트별 상태 (연결됨/재연결 중/서버 오류)
                if Self.isAuthClosed(code) { authClosedFolders.insert(f) } else { authClosedFolders.remove(f) }
            } else {
                statusText = shown
                if code == "idle" { connectedFolders = []; rootStatus = [:]; authClosedFolders = [] }
            }
        case let .connected(f):
            if !connectedFolders.contains(f) { connectedFolders.append(f) }
        case let .disconnected(f):
            connectedFolders.removeAll { $0 == f }
            rootStatus[f] = nil
            authClosedFolders.remove(f)
        case let .autoApprove(count):
            autoApproveCount = Int(clamping: count)
        case let .endpoints(_, webUrl, _):
            resolvedWebUrl = webUrl
        case let .browserControl(user):
            browserUserControl = user
        case let .confirm(id, command, taskId, base, _, sandbox):
            let asker = host // 물은 호스트에 답한다 — 창이 떠 있는 동안 호스트가 바뀌어도
            Task { await presentConfirm(host: asker, id: id, command: command, taskId: taskId, base: base, sandboxed: sandbox) }
        case let .taskEnd(taskId, _):
            notifyTaskEnd(taskId: taskId)
        case let .approvalPending(taskId, toolName, _):
            notifyApprovalPending(taskId: taskId, toolName: toolName)
        case .browserStopped, .exited:
            break
        }
    }

    /** 잠금 주인의 실행 파일 경로 → 그 `.app` 경로(번들 밖 실행이면 그대로). */
    static func appPath(_ exe: String) -> String {
        guard let r = exe.range(of: ".app/Contents/MacOS/") else { return exe }
        return String(exe[..<r.lowerBound]) + ".app"
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

    /** exec 승인 — 비우회 네이티브 다이얼로그. 실행될 명령 원문·실행 폴더를 그대로 보여준다. 창은 main 큐 블록 밖에서 돈다
        (AppTermination.runModal) — 종료 요청으로 끝난 창·띄우지 않은 창은 거부로 답한다. */
    private func presentConfirm(host: BridgeHostProtocol?, id: UInt64, command: String, taskId: String?, base: String,
                                sandboxed: Bool) async {
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
        let r = await AppTermination.runModal { self.showConfirm(alert) }
        let choice: ConfirmChoice
        if r == .alertFirstButtonReturn { choice = .yes }
        else if taskId != nil && r == .alertSecondButtonReturn { choice = .all }
        else { choice = .no }
        try? host?.answerConfirm(id: id, choice: choice)
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
