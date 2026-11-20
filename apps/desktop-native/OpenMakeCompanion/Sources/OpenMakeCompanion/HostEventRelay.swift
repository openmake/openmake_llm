// HostEventRelay — Rust 디스패처 스레드(하나)가 부르는 HostListener 를 main 큐로 넘긴다(PR-3.2 D-226).
// 한 스레드에서 main 큐(FIFO)로 넣으므로 이벤트 순서가 Rust 가 낸 순서 그대로다. 세대 번호로 옛 호스트의 이벤트를 거른다 —
// 옛 세대는 exited 만 받아 "끝남" 기록에 쓰고 나머지는 버린다(종전 `self.process === proc` 신원 확인과 같은 역할).
import Foundation
import OmkFfi

final class HostEventRelay: HostListener, @unchecked Sendable {
    /** 이 relay 가 붙은 호스트의 세대. 불변. */
    let generation: Int
    private let current: @MainActor () -> Int
    private let onEvent: @MainActor (HostEvent) -> Void
    private let onExited: @MainActor (Int, Int32) -> Void

    /**
     * - current: 지금 세대(main 에서 읽는다).
     * - onEvent: 지금 세대의 exited 아닌 이벤트.
     * - onExited: (세대, 종료 코드) — 세대와 무관하게 언제나.
     */
    init(generation: Int,
         current: @escaping @MainActor () -> Int,
         onEvent: @escaping @MainActor (HostEvent) -> Void,
         onExited: @escaping @MainActor (Int, Int32) -> Void) {
        self.generation = generation
        self.current = current
        self.onEvent = onEvent
        self.onExited = onExited
    }

    func onEvent(event: HostEvent) {
        DispatchQueue.main.async { MainActor.assumeIsolated { self.deliver(event) } }
    }

    @MainActor private func deliver(_ event: HostEvent) {
        if case let .exited(code) = event {
            onExited(generation, code)
        } else if generation == current() {
            onEvent(event)
        }
    }
}
