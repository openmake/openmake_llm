// 작업 창(PR-3.3 D-254·D-268) — AppKit NSWindow + NSHostingView(SwiftUI 내용). SwiftUI Window scene 은 쓰지 않는다(기동 때
// 저절로 열리는지 macOS 14 에서 확인 못 함, U-2). 메뉴 "작업 보기…" 로만 열고, 닫으면 숨김(상태는 모델에 남는다).
// 활성화 정책 .accessory 그대로(Dock·⌘Tab 없음). 설정 창은 메뉴 Scene 이 가진 openSettings 를 클로저로 받아 연다(T0 ⑤).
import AppKit
import SwiftUI

@MainActor
final class TasksWindow: NSObject, NSWindowDelegate {
    static let shared = TasksWindow()

    private var window: NSWindow?
    private var openSettings: () -> Void = {}

    func show(openSettings: @escaping () -> Void) {
        self.openSettings = openSettings
        let w = window ?? make()
        window = w
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        TasksModel.shared.shown()
    }

    private func make() -> NSWindow {
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 620),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = L("tasks.window.title")
        w.isReleasedWhenClosed = false
        w.contentMinSize = NSSize(width: 760, height: 480)
        w.contentView = NSHostingView(rootView: TasksView(model: .shared, openSettings: { [weak self] in self?.openSettings() }))
        if !w.setFrameUsingName("OpenMakeTasks") { w.center() }
        w.setFrameAutosaveName("OpenMakeTasks")
        w.delegate = self
        return w
    }

    func windowWillClose(_ notification: Notification) {
        TasksModel.shared.hidden()
    }
}
