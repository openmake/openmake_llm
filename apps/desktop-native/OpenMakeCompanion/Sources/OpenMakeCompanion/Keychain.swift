// Keychain — API key(omk_live_*) 저장. 디스크 평문 저장 금지(설정 파일·UserDefaults 불가).
// 조회 결과는 실행 동안 메모리에만 기억한다(D-120) — ad-hoc 서명이라 업데이트로 앱 신원이 바뀌면
// 옛 항목 조회마다 키체인 창이 떠서(기동·설정 열기·저장 3회) 한 번으로 줄인다. 부르는 곳은 모두 주 스레드.
import Foundation
import Security

enum Keychain {
    private static let service = "cc.openmake.companion"
    private static let account = "api-key"
    /** nil = 아직 조회 안 함, .some(nil) = 조회했으나 없음·실패. */
    private static var cached: String??

    static func save(_ value: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        cached = .some(value.isEmpty ? nil : value)
        guard !value.isEmpty else { return }
        var add = query
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> String? {
        if let c = cached { return c }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        var value: String?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
            value = String(data: data, encoding: .utf8)
        }
        cached = .some(value)
        return value
    }
}
