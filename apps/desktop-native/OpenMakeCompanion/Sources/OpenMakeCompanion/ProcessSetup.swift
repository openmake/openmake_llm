// ProcessSetup — 앱 프로세스 전역 설정(PR-3.2). 브리지 호스트(Rust)가 같은 프로세스 안에서 돌므로 신호·환경은 앱(Swift)이 정한다.
// CompanionApp.init() 첫 줄에서 부른다(HelperManager 가 만들어지기 전, D-229(r2)).
import AppKit
import Darwin

enum ProcessSetup {
    /** 개발 훅 키(환경 OMK_COMPANION_API_KEY) — apply() 가 읽어 담고 환경에서 지운다. 정식 실행 경로는 Keychain 만 쓴다. */
    private(set) static var devApiKey: String?
    /** SIGTERM·SIGINT 를 받았을 때(main 큐 블록) — 기본은 정상 종료 경로(applicationShouldTerminate → 호스트 정리). 이 블록
        안에서 바로 terminate 하면 .terminateLater 가 교착하므로 AppTermination.request() 로 run loop 소스에 넘긴다(R-10). 시험이 바꾼다. */
    static var onTerminateSignal: @MainActor () -> Void = { AppTermination.request() }
    private static var signalSources: [DispatchSourceSignal] = []

    /** 멱등 — 신호 설정은 한 번, 개발 훅 키는 부를 때마다 환경에 있으면 옮긴다. */
    static func apply() {
        takeDevApiKey()
        guard signalSources.isEmpty else { return }
        // 정적 라이브러리는 Rust 실행 파일과 달리 SIGPIPE 를 무시로 두지 않는다 — 닫힌 파이프에 쓰면 앱이 죽는다(D-228).
        // 띄우는 자식은 std 가 기본값으로 되돌린다(T0-c 실측).
        signal(SIGPIPE, SIG_IGN)
        // SIGTERM·SIGINT 는 SIG_IGN 이 아닌 빈 처리기 — 무시 상태는 exec 를 건너 자식(사용자 명령)에 상속되지만 잡은 처리기는
        // exec 때 기본값으로 돌아간다. 처리는 디스패치 소스(kqueue)가 main 큐에서 한다(D-242).
        for sig in [SIGTERM, SIGINT] {
            signal(sig) { _ in }
            let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            src.setEventHandler { MainActor.assumeIsolated { onTerminateSignal() } }
            src.resume()
            signalSources.append(src)
        }
    }

    /** 시험이 바꾼 개발 훅 키를 시험 전 값으로 되돌린다 — 시험 격리 전용(Astra r2 L-1). */
    static func restoreDevApiKeyForTests(_ key: String?) { devApiKey = key }

    /** 키는 환경에 남기지 않는다 — Chrome 은 프로세스 환경을 물려받는다(D-229). */
    private static func takeDevApiKey() {
        guard let raw = getenv("OMK_COMPANION_API_KEY") else { return }
        devApiKey = String(cString: raw)
        unsetenv("OMK_COMPANION_API_KEY")
    }
}
