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

    /** 저장 실패(`SecItemAdd` 실패)면 캐시를 "미조회"로 되돌려 다음 `load()` 가 실제 상태를 본다. */
    @discardableResult
    static func save(_ value: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        cached = .some(value.isEmpty ? nil : value)
        guard !value.isEmpty else { return true }
        var add = query
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else {
            cached = nil
            return false
        }
        return true
    }

    /** 저장 없이 이번 실행의 캐시에만 둔다 — 넘겨받은 키의 저장이 실패했을 때만(KeyHandoff). */
    static func remember(_ value: String) {
        cached = .some(value)
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
