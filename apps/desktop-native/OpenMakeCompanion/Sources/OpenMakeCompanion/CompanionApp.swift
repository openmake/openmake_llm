// OpenMake Companion — 메뉴바 상주 로컬 에이전트 컴패니언.
// 역할 한정(plan §1 비목표): 채팅 UI 없음 — 깊은 작업은 웹으로 딥링크 핸드오프.
import AppKit
import SwiftUI
import UserNotifications

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // 메뉴바 전용 (Dock 미노출)
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in /* 거부는 fail-open */ }
        Task { @MainActor in
            HelperManager.shared.reconnectIfPossible()
            Updater.shared.scheduleStartupCheck(backendUrl: HelperManager.shared.backend.url)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        Task { @MainActor in HelperManager.shared.stopHelper() }
    }

    // 알림 클릭 → 웹 핸드오프
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        if let s = response.notification.request.content.userInfo["url"] as? String,
           let url = URL(string: s) {
            NSWorkspace.shared.open(url)
        }
    }

    // 앱이 전면일 때도 배너 표시
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}

@main
struct CompanionApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var helper = HelperManager.shared

    var body: some Scene {
        MenuBarExtra("OpenMake", systemImage: !helper.connectedFolders.isEmpty ? "folder.badge.gearshape" : "folder.badge.questionmark") {
            MenuContent().environmentObject(helper)
        }
        Settings {
            SettingsView().environmentObject(helper)
        }
    }
}

struct MenuContent: View {
    @EnvironmentObject var helper: HelperManager
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        if helper.connectedFolders.isEmpty {
            Text("상태: \(helper.statusText)")
        }
        // 다중 루트 — 루트별 서브메뉴 (전체 경로는 로컬 표시 전용, 서버엔 basename 만 감)
        ForEach(helper.connectedFolders, id: \.self) { f in
            Menu("폴더: \(URL(fileURLWithPath: f).lastPathComponent)") {
                Text(f)
                if let st = helper.rootStatus[f] { Text("상태: \(st)") }
                Button("Finder 에서 열기") { NSWorkspace.shared.open(URL(fileURLWithPath: f)) }
                Button("연결 해제") { helper.disconnect(folder: f) }
            }
        }
        Divider()
        Button(helper.connectedFolders.isEmpty ? "작업 폴더 연결…" : "작업 폴더 추가…") { helper.chooseFolderAndConnect() }
        if helper.connectedFolders.count > 1 {
            Button("전체 연결 해제") { helper.disconnectAll() }
        }
        if helper.autoApproveCount > 0 {
            Button("일괄 승인 해제 (\(helper.autoApproveCount)개 작업)") { helper.clearAutoApprove() }
        }
        Divider()
        Button("웹에서 열기") { helper.openWeb() }
        Button("업데이트 확인…") {
            Task { await Updater.shared.check(backendUrl: helper.backend.url, interactive: true) }
        }
        Button("설정…") {
            openSettings()
            NSApp.activate(ignoringOtherApps: true)
        }
        Divider()
        Button("종료") {
            helper.stopHelper()
            NSApp.terminate(nil)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var helper: HelperManager
    @State private var apiKey: String = Keychain.load() ?? ""
    @State private var backendId: String = HelperManager.shared.backendId
    @State private var saved = false

    var body: some View {
        Form {
            Section("인증") {
                SecureField("API key (omk_live_…)", text: $apiKey)
                Text("웹 설정 → API 키에서 bridge 스코프 키를 발급해 붙여넣으세요. Keychain 에 저장됩니다.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("백엔드") {
                Picker("서버", selection: $backendId) {
                    ForEach(HelperManager.backends, id: \.id) { b in
                        Text(b.label).tag(b.id)
                    }
                }
            }
            HStack {
                Button("저장") {
                    Keychain.save(apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
                    if backendId != helper.backendId { helper.switchBackend(backendId) }
                    saved = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { saved = false }
                }
                if saved { Text("저장됨").foregroundStyle(.green) }
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}
