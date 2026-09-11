// OpenMake Companion — 메뉴바 상주 로컬 에이전트 컴패니언.
// 역할 한정(plan §1 비목표): 채팅 UI 없음 — 깊은 작업은 웹으로 딥링크 핸드오프.
// 사용자 문구는 전부 L(키) — Localization/<lang>.lproj (L10n.swift 참고).
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
            Text(L("menu.status", helper.statusText))
        }
        // 다중 루트 — 루트별 서브메뉴 (전체 경로는 로컬 표시 전용, 서버엔 basename 만 감)
        ForEach(helper.connectedFolders, id: \.self) { f in
            Menu(L("menu.folder", URL(fileURLWithPath: f).lastPathComponent)) {
                Text(f)
                if let st = helper.rootStatus[f] { Text(L("menu.status", st)) }
                Button(L("menu.openInFinder")) { NSWorkspace.shared.open(URL(fileURLWithPath: f)) }
                Button(L("menu.disconnect")) { helper.disconnect(folder: f) }
            }
        }
        Divider()
        Button(helper.connectedFolders.isEmpty ? L("menu.connectFolder") : L("menu.addFolder")) { helper.chooseFolderAndConnect() }
        if helper.connectedFolders.count > 1 {
            Button(L("menu.disconnectAll")) { helper.disconnectAll() }
        }
        if helper.autoApproveCount > 0 {
            Button(L("menu.clearAutoApprove", helper.autoApproveCount)) { helper.clearAutoApprove() }
        }
        Divider()
        Button(L("menu.openWeb")) { helper.openWeb() }
        Button(L("menu.checkUpdates")) {
            Task { await Updater.shared.check(backendUrl: helper.backend.url, interactive: true) }
        }
        Button(L("menu.settings")) {
            openSettings()
            NSApp.activate(ignoringOtherApps: true)
        }
        Divider()
        Button(L("menu.quit")) {
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
            Section(L("settings.auth")) {
                SecureField(L("settings.apiKey.placeholder"), text: $apiKey)
                Text(L("settings.apiKey.help"))
                    .font(.caption).foregroundStyle(.secondary)
                // 키 발급 위치는 웹의 API 액세스 페이지(/api-access) — 설정 탭이 아니다.
                Button(L("settings.apiKey.open")) { helper.openApiAccess(backendId: backendId) }
            }
            Section(L("settings.backend")) {
                Picker(L("settings.server"), selection: $backendId) {
                    ForEach(HelperManager.backends, id: \.id) { b in
                        Text(L(b.label)).tag(b.id)
                    }
                }
            }
            HStack {
                Button(L("settings.save")) {
                    Keychain.save(apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
                    if backendId != helper.backendId { helper.switchBackend(backendId) }
                    saved = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { saved = false }
                }
                if saved { Text(L("settings.saved")).foregroundStyle(.green) }
            }
        }
        .padding(20)
        .frame(width: 420)
    }
}
