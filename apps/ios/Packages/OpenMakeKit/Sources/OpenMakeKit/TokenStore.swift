// OpenMakeKit — 토큰 저장소 (축 3 Step 2)
//
// 서버 계약(축 2): 모바일은 access/refresh 를 쿠키가 아닌 body 로 주고받는다.
// refresh token 은 장기 크리덴셜이므로 Keychain 에만 저장한다 (UserDefaults 금지 — v2 문서 8절).
import Foundation
import Security

public struct AuthTokens: Codable, Equatable, Sendable {
    public let access: String
    public let refresh: String

    public init(access: String, refresh: String) {
        self.access = access
        self.refresh = refresh
    }
}

public protocol TokenStore: Sendable {
    func load() -> AuthTokens?
    func save(_ tokens: AuthTokens)
    func clear()
}

/// 테스트·SwiftUI 프리뷰용 인메모리 구현
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: AuthTokens?

    public init() {}

    public func load() -> AuthTokens? {
        lock.lock(); defer { lock.unlock() }
        return tokens
    }

    public func save(_ tokens: AuthTokens) {
        lock.lock(); defer { lock.unlock() }
        self.tokens = tokens
    }

    public func clear() {
        lock.lock(); defer { lock.unlock() }
        tokens = nil
    }
}

/// Keychain 구현 — 기기 잠금 해제 후 접근 가능, iCloud 미동기화 (ThisDeviceOnly)
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service: String
    private let account = "auth-tokens"

    public init(service: String = "cc.openmake.chat") {
        self.service = service
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func load() -> AuthTokens? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(AuthTokens.self, from: data)
    }

    public func save(_ tokens: AuthTokens) {
        guard let data = try? JSONEncoder().encode(tokens) else { return }
        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecDuplicateItem {
            SecItemUpdate(
                baseQuery as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
        }
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
