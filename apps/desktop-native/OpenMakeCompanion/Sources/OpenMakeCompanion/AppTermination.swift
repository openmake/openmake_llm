// AppTermination — 앱 종료 요청(PR-3.2 r3, R-10). main 디스패치 큐 블록(신호 소스 처리기·Task @MainActor) 안에서
// NSApp.terminate 를 바로 부르면 안 된다: 호스트가 살아 있으면 applicationShouldTerminate 가 .terminateLater 를 돌려주고
// AppKit 이 중첩 run loop 로 reply 를 기다리는데, reply 를 줄 Task @MainActor 는 main 큐 작업이라 이미 블록을 실행 중인
// main 큐가 다시 들어가지 않아 영원히 기다린다(교착). 그래서 main run loop 소스(블록)로 넘겨 부른다 — 그 안의 중첩 루프는
// main 큐를 비울 수 있고, common modes 라 메뉴 추적 중에도 실행된다.
import AppKit

enum AppTermination {
    /** 실제 종료 — 시험이 바꾼다. */
    static var terminate: @MainActor () -> Void = { NSApp.terminate(nil) }

    /** 종료를 요청한다 — 지금 실행 중인 main 큐 블록이 끝난 뒤 run loop 소스에서 terminate 를 부른다. */
    @MainActor
    static func request() {
        performOnMainRunLoop { terminate() }
    }

    /** main run loop 에 블록을 얹고 깨운다(common modes) — main 디스패치 큐 작업이 아니다. */
    @MainActor
    static func performOnMainRunLoop(_ body: @escaping @MainActor () -> Void) {
        let loop = CFRunLoopGetMain()
        CFRunLoopPerformBlock(loop, CFRunLoopMode.commonModes.rawValue) { MainActor.assumeIsolated { body() } }
        CFRunLoopWakeUp(loop)
    }
}
