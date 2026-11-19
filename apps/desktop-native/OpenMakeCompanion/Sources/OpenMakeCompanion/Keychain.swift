// Keychain — API key(omk_live_*) 저장. 디스크 평문 저장 금지(설정 파일·UserDefaults 불가).
// 두 층(plan-pr2.5 D-167):
//  - KeychainStore: 캐시 없는 실제 저장소. loadPersisted() 는 매번 Security 를 조회한다 — 옛 항목 삭제처럼
//    "영구 저장돼 있다"는 증거가 필요한 판단은 이것만 쓴다. Security 원시 호출 셋은 테스트가 바꿔 끼운다.
//  - Keychain: 그 위의 메모리 캐시층(연결·설정 화면용 메모리 키). 조회 결과는 실행 동안 메모리에만 기억한다(D-120) —
//    ad-hoc 서명이라 신원이 바뀌면 옛 항목 조회마다 키체인 창이 떠서 한 번으로 줄인다. 부르는 곳은 모두 주 스레드.
import Foundation
import Security

struct KeychainStore {
    enum ReadResult: Equatable {
        case value(String)
        case notFound
        /** 조회 실패·거부(사용자가 키체인 창에서 거부 등). */
        case failed(OSStatus)
    }

    let service: String
    var account = "api-key"
    var secAdd: (CFDictionary) -> OSStatus = { SecItemAdd($0, nil) }
    var secCopyMatching: (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus = { SecItemCopyMatching($0, $1) }
    var secDelete: (CFDictionary) -> OSStatus = { SecItemDelete($0) }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    /** 삭제 후 추가. 빈 값은 삭제만 하고 true. 추가가 errSecSuccess 일 때만 true. */
    @discardableResult
    func save(_ value: String) -> Bool {
        _ = secDelete(query as CFDictionary)
        guard !value.isEmpty else { return true }
        var add = query
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return secAdd(add as CFDictionary) == errSecSuccess
    }

    /** 실제 조회 — 캐시를 보지도 채우지도 않는다. */
    func read() -> ReadResult {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = secCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return .notFound }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            return .failed(status)
        }
        return .value(value)
    }

    func loadPersisted() -> String? {
        if case let .value(v) = read() { return v }
        return nil
    }

    /** 성공 또는 이미 없음이면 true. */
    @discardableResult
    func delete() -> Bool {
        let status = secDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

enum Keychain {
    /** 이 앱의 저장소. 바꾸면(테스트) 캐시도 비운다. */
    static var store = KeychainStore(service: AppIdentity.keychainService) {
        didSet { cached = nil }
    }
    /** nil = 아직 조회 안 함, .some(nil) = 조회했으나 없음·실패. */
    private static var cached: String??

    /** 저장 실패면 캐시를 "미조회"로 되돌려 다음 `load()` 가 실제 상태를 본다. */
    @discardableResult
    static func save(_ value: String) -> Bool {
        cached = .some(value.isEmpty ? nil : value)
        guard store.save(value) else {
            cached = nil
            return false
        }
        return true
    }

    /** 저장 없이 이번 실행의 캐시에만 둔다 — 넘겨받은·옮긴 키의 저장이 실패했을 때만. */
    static func remember(_ value: String) {
        cached = .some(value)
    }

    static func load() -> String? {
        if let c = cached { return c }
        let value = store.loadPersisted()
        cached = .some(value)
        return value
    }
}
