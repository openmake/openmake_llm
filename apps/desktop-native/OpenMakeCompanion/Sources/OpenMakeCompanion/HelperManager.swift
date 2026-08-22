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

    @Published var statusText = "미연결"
    @Published var connectedFolder: String? = nil
    @Published var autoApproveCount = 0

    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutBuf = Data()

    // 백엔드 선택 — Electron 셸과 동일 2종. 로컬은 Next(3000)가 WS 를 프록시하지 못하므로
    // 백엔드(52416) 직결 (기존 bridgeBackendUrl 관행).
    static let backends: [(id: String, label: String, url: String, webUrl: String)] = [
        ("external", "외부 (chat.openmake.cc)", "https://chat.openmake.cc", "https://chat.openmake.cc"),
        ("local", "로컬 (localhost:52416)", "http://localhost:52416", "http://localhost:3000"),
    ]
    var backendId: String {
        get { UserDefaults.standard.string(forKey: "backend") ?? "external" }
        set { UserDefaults.standard.set(newValue, forKey: "backend") }
    }
    var backend: (id: String, label: String, url: String, webUrl: String) {
        Self.backends.first { $0.id == backendId } ?? Self.backends[0]
    }
    /** 마지막 연결 폴더 — 재기동 시 자동 재연결용(로컬 UserDefaults, 서버 미전송). */
    var lastFolder: String? {
        get { UserDefaults.standard.string(forKey: "lastFolder") }
        set { UserDefaults.standard.set(newValue, forKey: "lastFolder") }
    }

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
            statusText = "API key 필요 — 설정에서 입력"
            return false
        }
        guard let nodeURL = resourceURL("node"), FileManager.default.isExecutableFile(atPath: nodeURL.path),
              let helperURL = resourceURL("helper.cjs"), FileManager.default.fileExists(atPath: helperURL.path) else {
            statusText = "헬퍼 리소스 없음 (재설치 필요)"
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
                if self?.connectedFolder != nil { self?.statusText = "헬퍼 종료됨 — 다시 연결하세요" }
                self?.connectedFolder = nil
            }
        }
        do { try p.run() } catch {
            statusText = "헬퍼 실행 실패: \(error.localizedDescription)"
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
        connectedFolder = nil
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
        panel.title = "에이전트 작업에 연결할 폴더 선택"
        panel.message = "이 폴더(와 하위 폴더)를 작업 기준으로 파일을 읽고 씁니다. 셸 명령은 실행 전 매번 확인을 받고, 승인해도 OS 샌드박스가 폴더 밖 쓰기와 비밀 파일(.ssh 등) 읽기를 차단합니다."
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        connect(folder: url.path)
    }

    func connect(folder: String) {
        guard ensureHelper() else { return }
        lastFolder = folder
        send(["cmd": "connect", "folder": folder])
    }

    func reconnectIfPossible() {
        // 테스트 훅(개발/E2E 전용): 폴더가 env 로 지정되면 패널 없이 자동 연결
        // (Electron 의 OMK_BRIDGE_FOLDER 와 동일 계열).
        if let f = ProcessInfo.processInfo.environment["OMK_COMPANION_FOLDER"] { connect(folder: f); return }
        if let f = lastFolder, Keychain.load() != nil { connect(folder: f) }
    }

    func disconnect() {
        send(["cmd": "disconnect"])
        connectedFolder = nil
    }

    func clearAutoApprove() { send(["cmd": "clearAutoApprove"]) }

    /** 백엔드 전환 — 헬퍼 재기동(서버 URL 은 spawn 인자) 후 재연결. */
    func switchBackend(_ id: String) {
        backendId = id
        let wasConnected = connectedFolder ?? lastFolder
        stopHelper()
        if let f = wasConnected {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.connect(folder: f) }
        }
    }

    func openWeb() {
        if let url = URL(string: backend.webUrl) { NSWorkspace.shared.open(url) }
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
            statusText = ev["text"] as? String ?? ""
            if statusText == "미연결" { connectedFolder = nil }
        case "connected":
            connectedFolder = ev["folder"] as? String
        case "autoApprove":
            autoApproveCount = ev["count"] as? Int ?? 0
        case "confirm":
            presentConfirm(ev)
        case "taskEnd":
            notifyTaskEnd(taskId: ev["taskId"] as? String)
        default:
            break
        }
    }

    /** exec 승인 — 비우회 네이티브 다이얼로그. 실행될 명령 원문·실행 폴더를 그대로 보여준다. */
    private func presentConfirm(_ ev: [String: Any]) {
        let id = ev["id"] as? Int ?? 0
        let command = ev["command"] as? String ?? ""
        let taskId = ev["taskId"] as? String
        let base = ev["base"] as? String ?? connectedFolder ?? ""
        let sandboxed = ev["sandbox"] as? Bool ?? false
        let preview = command.count > 800 ? String(command.prefix(800)) + "…" : command

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "에이전트가 이 셸 명령을 당신의 컴퓨터에서 실행하려고 합니다"
        var detail = "\(preview)\n\n실행 폴더: \(base)\n"
        detail += sandboxed
            ? "OS 샌드박스 적용: 폴더 밖 쓰기와 비밀 파일(.ssh/.aws 등) 읽기는 차단됩니다. 그 외 읽기·네트워크는 허용됩니다."
            : "⚠️ 샌드박스 미적용: 이 명령은 당신 계정 권한으로 폴더 밖 파일·네트워크에 접근할 수 있습니다."
        if taskId != nil {
            detail += "\n\n\"이 작업 동안 모두 실행\"을 고르면 이 작업이 끝날 때까지 다시 묻지 않습니다(다른 작업에는 적용되지 않습니다)."
        }
        alert.informativeText = detail
        alert.addButton(withTitle: "실행")
        if taskId != nil { alert.addButton(withTitle: "이 작업 동안 모두 실행") }
        alert.addButton(withTitle: "거부")
        NSApp.activate(ignoringOtherApps: true)
        let r = alert.runModal()
        let result: String
        if r == .alertFirstButtonReturn { result = "yes" }
        else if taskId != nil && r == .alertSecondButtonReturn { result = "all" }
        else { result = "no" }
        send(["cmd": "confirm", "id": id, "result": result])
    }

    /** 작업 종료 알림 — 클릭 시 웹 작업 상세로 핸드오프(상세 UI 는 웹 단일 구현 원칙).
        ask_human/승인 대기 알림은 서버 web-push 가 담당(turn-executor onApprovalPending) — 중복 구현 안 함. */
    private func notifyTaskEnd(taskId: String?) {
        let content = UNMutableNotificationContent()
        content.title = "에이전트 작업 종료"
        content.body = "로컬 작업이 끝났습니다. 결과를 웹에서 확인하세요."
        // 웹 작업 상세 딥링크 계약: /agent-tasks?task=<id> (admin/conversations 와 동일 패턴)
        let url = taskId.map { "\(backend.webUrl)/agent-tasks?task=\($0)" } ?? backend.webUrl
        content.userInfo = ["url": url]
        let req = UNNotificationRequest(identifier: taskId ?? UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req) { _ in /* 권한 거부 등은 무시(fail-open) */ }
    }
}
