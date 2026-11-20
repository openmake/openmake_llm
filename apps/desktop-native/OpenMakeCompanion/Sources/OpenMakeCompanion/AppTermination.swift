// AppTermination — 앱 종료 요청(PR-3.2 r3, R-10). main 디스패치 큐 블록(신호 소스 처리기·Task @MainActor) 안에서
// NSApp.terminate 를 바로 부르면 안 된다: 호스트가 살아 있으면 applicationShouldTerminate 가 .terminateLater 를 돌려주고
// AppKit 이 중첩 run loop 로 reply 를 기다리는데, reply 를 줄 Task @MainActor 는 main 큐 작업이라 이미 블록을 실행 중인
// main 큐가 다시 들어가지 않아 영원히 기다린다(교착). 그래서 main run loop 소스(블록)로 넘겨 부른다 — 그 안의 중첩 루프는
// main 큐를 비울 수 있고, common modes 라 메뉴 추적 중에도 실행된다.
// 모달(승인 창·업데이트 안내·폴더 고르기)도 같은 이유로 run loop 소스에서 돌린다(runModal) — main 큐 블록 안에서 돌면 창이 떠 있는
// 동안 main 큐(호스트 이벤트·신호·종료 reply)가 멈춘다. 종료 요청은 떠 있는 모달을 끝내고(abort — 승인 창은 거부로 답한다)
// 그 뒤로는 새 모달을 띄우지 않는다(Astra r1 H-1 후속).
// 요청은 한 번만 — .terminateLater 대기(중첩 루프) 중 NSApp.terminate 에 다시 들어가면 AppKit 은 delegate 를 다시 묻지 않고 바로
// 끝내 호스트 정리가 끊긴다(D-233). 그래서 두 번째 신호·업데이트·메뉴 종료와 겹친 요청, 로그아웃 등 직접 종료(applicationShouldTerminate
// 가 didEnter 로 requested·entered 를 세운다) 뒤의 신호는 무시한다(PR-3.2 Opus r4 M-1·Astra r2 H-1). 요청 예약(requested)과 실제 종료
// 진입(entered)은 따로 둔다 — 예약된 콜백·모달 재확인 타이머가 직접 종료 뒤에 돌면 terminate 를 다시 부르지 않는다(Astra r3 H-1).
import AppKit

enum AppTermination {
    /** 실제 종료 — 시험이 바꾼다. */
    static var terminate: @MainActor () -> Void = { NSApp.terminate(nil) }
    /** 모달이 떠 있는가 / 그 모달을 끝낸다 — 시험이 바꾼다. */
    static var modalRunning: @MainActor () -> Bool = { NSApp?.modalWindow != nil }
    static var abortModal: @MainActor () -> Void = { NSApp?.abortModal() }
    /** 종료가 요청됐거나 진행 중이다 — 이 뒤로는 모달을 띄우지 않고 종료 요청을 다시 하지 않는다. 시험이 되돌린다. */
    static var requested = false
    /** 실제 종료에 들어갔다(applicationShouldTerminate) — 예약된 종료 콜백은 아무것도 하지 않는다. 시험이 되돌린다. */
    static var entered = false
    /** applicationShouldTerminate 첫 줄 — 종료 진입을 남긴다. */
    @MainActor
    static func didEnter() {
        requested = true
        entered = true
    }
    /** 마지막으로 차례를 잡은 모달 — 모달은 하나씩(앞 창이 닫힌 뒤 다음 창). */
    private static var lastModal: Task<Void, Never>?

    /** 종료를 요청한다 — 지금 실행 중인 main 큐 블록이 끝난 뒤 run loop 소스에서, 떠 있는 모달을 끝낸 다음 terminate 를 부른다.
        이미 요청됐거나 진행 중이면 아무것도 하지 않는다(멱등). */
    @MainActor
    static func request() {
        guard !requested else { return }
        requested = true
        performOnMainRunLoop(terminateAfterModal)
    }

    /** 모달이 떠 있으면 끝내고 잠시 뒤(50ms) 다시 본다 — 모달 안에서 terminate 하지 않는다. abort 를 받은 창이 닫히기까지 run
        loop 가 여러 번 돈다(NSOpenPanel 실측 수십 ms, 블록을 바로 다시 얹으면 수백 번 헛돈다 — Opus r4 N-1). 그 사이 종료가 이미
        시작됐으면(직접 종료가 delegate 에 들어가 정리 대기 중) 아무것도 하지 않는다. */
    @MainActor
    private static func terminateAfterModal() {
        guard !entered else { return }
        guard modalRunning() else { return terminate() }
        abortModal()
        performOnMainRunLoop(after: 0.05, terminateAfterModal)
    }

    /** 모달을 run loop 소스에서 하나씩 돌리고 그 답을 준다. 종료가 요청됐으면 띄우지 않고 .abort. */
    @MainActor
    static func runModal(_ show: @escaping @MainActor () -> NSApplication.ModalResponse) async -> NSApplication.ModalResponse {
        let previous = lastModal
        let mine = Task { @MainActor () -> NSApplication.ModalResponse in
            await previous?.value
            return await withCheckedContinuation { c in
                performOnMainRunLoop { c.resume(returning: requested ? .abort : show()) }
            }
        }
        lastModal = Task { _ = await mine.value }
        return await mine.value
    }

    /** main run loop 에 블록을 얹고 깨운다(common modes) — main 디스패치 큐 작업이 아니다. */
    @MainActor
    static func performOnMainRunLoop(_ body: @escaping @MainActor () -> Void) {
        let loop = CFRunLoopGetMain()
        CFRunLoopPerformBlock(loop, CFRunLoopMode.commonModes.rawValue) { MainActor.assumeIsolated { body() } }
        CFRunLoopWakeUp(loop)
    }

    /** delay 뒤 main run loop 에서(common modes 타이머 — 모달·메뉴 추적 중에도 돈다). main 디스패치 큐 작업이 아니다. */
    @MainActor
    private static func performOnMainRunLoop(after delay: TimeInterval, _ body: @escaping @MainActor () -> Void) {
        let timer = CFRunLoopTimerCreateWithHandler(nil, CFAbsoluteTimeGetCurrent() + delay, 0, 0, 0) { _ in
            MainActor.assumeIsolated { body() }
        }
        CFRunLoopAddTimer(CFRunLoopGetMain(), timer, .commonModes)
    }
}
