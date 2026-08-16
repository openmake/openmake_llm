import Foundation

public enum NativePushEnvironment: String, Codable, Sendable {
    case development
    case production
}

public extension OpenMakeClient {
    func registerNativePushToken(
        _ deviceToken: String,
        environment: NativePushEnvironment,
        bundleId: String
    ) async throws {
        struct Request: Encodable {
            let deviceToken: String
            let environment: NativePushEnvironment
            let bundleId: String
        }
        _ = try await authorizedSend(
            method: "POST",
            path: "/api/push/native/subscribe",
            body: Request(
                deviceToken: deviceToken,
                environment: environment,
                bundleId: bundleId))
    }

    func unregisterNativePushToken(_ deviceToken: String) async throws {
        struct Request: Encodable {
            let deviceToken: String
        }
        _ = try await authorizedSend(
            method: "POST",
            path: "/api/push/native/unsubscribe",
            body: Request(deviceToken: deviceToken))
    }
}
