// OpenMake iOS — 앱 진입점 (축 3 Step 1 골격)
import SwiftUI

@main
struct OpenMakeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
