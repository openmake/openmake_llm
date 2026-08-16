import Foundation
import Observation
import UIKit
import UserNotifications
import OpenMakeKit

@MainActor
@Observable
final class NotificationManager {
    enum RemoteStatus {
        case localOnly
        case registering
        case registered
        case failed
    }

    static let shared = NotificationManager()

    private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    private(set) var remoteStatus: RemoteStatus = .localOnly
    private var client: OpenMakeClient?
    private var pendingDeviceToken: Data?
    private var notifiedTaskIds: Set<String> = []

    private init() {}

    var statusText: String {
        switch authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            switch remoteStatus {
            case .registered: "원격 푸시 등록됨"
            case .registering: "원격 푸시 등록 중"
            case .failed: "기기 알림 켜짐 · 원격 등록 실패"
            case .localOnly: "기기 알림 켜짐"
            }
        case .denied: "알림이 꺼져 있습니다"
        case .notDetermined: "알림을 아직 허용하지 않았습니다"
        @unknown default: "알림 상태를 확인할 수 없습니다"
        }
    }

    var remotePushEnabled: Bool {
        Bundle.main.object(forInfoDictionaryKey: "OpenMakeRemotePushEnabled") as? Bool == true
    }

    func bind(client: OpenMakeClient) {
        self.client = client
        if let pendingDeviceToken {
            Task { await register(deviceToken: pendingDeviceToken) }
        }
    }

    func refreshStatus() async {
        authorizationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func requestAuthorization() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await activate()
        } catch {
            await refreshStatus()
        }
    }

    func activate() async {
        await refreshStatus()
        guard isAuthorized, remotePushEnabled else {
            remoteStatus = .localOnly
            return
        }
        if let pendingDeviceToken {
            await register(deviceToken: pendingDeviceToken)
            if self.pendingDeviceToken == nil { return }
        }
        remoteStatus = .registering
        UIApplication.shared.registerForRemoteNotifications()
    }

    func register(deviceToken: Data) async {
        pendingDeviceToken = deviceToken
        guard let client,
              let bundleId = Bundle.main.bundleIdentifier else { return }
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let environment: NativePushEnvironment
        #if DEBUG
        environment = .development
        #else
        environment = .production
        #endif
        do {
            try await client.registerNativePushToken(
                token,
                environment: environment,
                bundleId: bundleId)
            remoteStatus = .registered
            pendingDeviceToken = nil
        } catch {
            remoteStatus = .failed
        }
    }

    func registrationFailed() {
        remoteStatus = .failed
    }

    func notifyAgentTaskFinished(_ task: AgentTask) async {
        guard !notifiedTaskIds.contains(task.id) else { return }
        notifiedTaskIds.insert(task.id)
        let title = task.status == .completed ? "에이전트 작업 완료" : "에이전트 작업 종료"
        let body = task.status == .completed
            ? String(task.goal.prefix(80))
            : (task.error ?? String(task.goal.prefix(80)))
        await schedule(title: title, body: body, url: "/agent-tasks")
    }

    func schedule(title: String, body: String, url: String? = nil) async {
        await refreshStatus()
        guard isAuthorized else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        if let url { content.userInfo["url"] = url }
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        try? await UNUserNotificationCenter.current().add(request)
    }

    private var isAuthorized: Bool {
        [.authorized, .provisional, .ephemeral].contains(authorizationStatus)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            await NotificationManager.shared.register(deviceToken: deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            NotificationManager.shared.registrationFailed()
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let url = response.notification.request.content.userInfo["url"] as? String else { return }
        await MainActor.run {
            NotificationCenter.default.post(name: .openMakeNotificationURL, object: url)
        }
    }
}

extension Notification.Name {
    static let openMakeNotificationURL = Notification.Name("OpenMakeNotificationURL")
}
