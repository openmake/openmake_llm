// 첫 실행 이전 계획(plan-pr2.5 §4.2) — 순수 함수 전 조합. 시각·나이·수정 시각은 입력이 아니다.
import XCTest
@testable import OpenMakeCompanion

final class MigrationPlanTests: XCTestCase {
    typealias P = MigrationPlan

    private let markers: [MarkerState] = [.absent, .alive, .ended, .unreadable]
    private let allStates: [MigrationState?] = [nil, .cleanupPending, .done, .keychainSkipped, .nothing]

    private func plan(_ m: MarkerState, _ s: MigrationState?, _ k: Bool, bundle: Bool = true) -> MigrationPlan {
        MigrationPlan.plan(marker: m, state: s, newKeyPersisted: k, legacyBundlePresent: bundle)
    }

    // MARK: 4(marker) × 3(state) × 2(newKeyPersisted) = 24 줄 — 기대값을 직접 적은 표

    func testTwentyFourRowTable() {
        // (marker, state, newKeyPersisted) → 기대 계획(legacyBundlePresent = true)
        let none = P(copyDefaults: false, copyKey: false, keyCleanup: .keep, offerTrash: false, removeMarker: false, record: .keep)
        let rows: [(MarkerState, MigrationState?, Bool, MigrationPlan)] = [
            // 첫 기동(state 없음) × 살아 있음·못 읽음 → 복사만, 삭제·휴지통 ✕, cleanup-pending
            (.alive, nil, false, P(copyDefaults: true, copyKey: true, keyCleanup: .keep, offerTrash: false, removeMarker: false, record: .set(.cleanupPending))),
            (.alive, nil, true, P(copyDefaults: true, copyKey: false, keyCleanup: .keep, offerTrash: false, removeMarker: false, record: .set(.cleanupPending))),
            (.unreadable, nil, false, P(copyDefaults: true, copyKey: true, keyCleanup: .keep, offerTrash: false, removeMarker: false, record: .set(.cleanupPending))),
            (.unreadable, nil, true, P(copyDefaults: true, copyKey: false, keyCleanup: .keep, offerTrash: false, removeMarker: false, record: .set(.cleanupPending))),
            // 첫 기동 × 없음·끝남 → 복사, 삭제는 영구 키가 있거나 이번 복사가 성공했을 때, 휴지통 ○, 기록은 record()
            (.absent, nil, false, P(copyDefaults: true, copyKey: true, keyCleanup: .deleteIfCopied, offerTrash: true, removeMarker: false, record: .fromResult)),
            (.absent, nil, true, P(copyDefaults: true, copyKey: false, keyCleanup: .delete, offerTrash: true, removeMarker: false, record: .fromResult)),
            (.ended, nil, false, P(copyDefaults: true, copyKey: true, keyCleanup: .deleteIfCopied, offerTrash: true, removeMarker: true, record: .fromResult)),
            (.ended, nil, true, P(copyDefaults: true, copyKey: false, keyCleanup: .delete, offerTrash: true, removeMarker: true, record: .fromResult)),
            // cleanup-pending × 살아 있음·못 읽음 → 아무것도 하지 않음
            (.alive, .cleanupPending, false, none),
            (.alive, .cleanupPending, true, none),
            (.unreadable, .cleanupPending, false, none),
            (.unreadable, .cleanupPending, true, none),
            // cleanup-pending × 없음·끝남 → 영구 키가 있으면 삭제·휴지통·done, 없으면 삭제 ✕·휴지통 ✕·기록 그대로
            (.absent, .cleanupPending, false, none),
            (.absent, .cleanupPending, true, P(copyDefaults: false, copyKey: false, keyCleanup: .delete, offerTrash: true, removeMarker: false, record: .set(.done))),
            (.ended, .cleanupPending, false, P(copyDefaults: false, copyKey: false, keyCleanup: .keep, offerTrash: false, removeMarker: true, record: .keep)),
            (.ended, .cleanupPending, true, P(copyDefaults: false, copyKey: false, keyCleanup: .delete, offerTrash: true, removeMarker: true, record: .set(.done))),
            // 끝 상태(done) → 아무것도 하지 않음(끝난 표식만 지운다)
            (.alive, .done, false, none),
            (.alive, .done, true, none),
            (.unreadable, .done, false, none),
            (.unreadable, .done, true, none),
            (.absent, .done, false, none),
            (.absent, .done, true, none),
            (.ended, .done, false, P(copyDefaults: false, copyKey: false, keyCleanup: .keep, offerTrash: false, removeMarker: true, record: .keep)),
            (.ended, .done, true, P(copyDefaults: false, copyKey: false, keyCleanup: .keep, offerTrash: false, removeMarker: true, record: .keep)),
        ]
        XCTAssertEqual(rows.count, 24)
        for (m, s, k, expected) in rows {
            XCTAssertEqual(plan(m, s, k), expected, "marker \(m) state \(String(describing: s)) newKeyPersisted \(k)")
        }
    }

    func testTrashNeedsAnExistingLegacyBundle() {
        // 휴지통이 걸리는 칸만 legacyBundlePresent = false 로 한 번 더.
        for (m, s, k) in [(MarkerState.absent, nil as MigrationState?, false), (.absent, nil, true), (.ended, nil, false), (.ended, nil, true),
                          (.absent, .cleanupPending, true), (.ended, .cleanupPending, true)] {
            XCTAssertTrue(plan(m, s, k).offerTrash)
            XCTAssertFalse(plan(m, s, k, bundle: false).offerTrash, "marker \(m) state \(String(describing: s))")
        }
    }

    // MARK: 불변식 — 4 × 5 × 2 × 2 = 80 조합

    func testInvariantsOverAllCombinations() {
        var n = 0
        for m in markers {
            for s in allStates {
                for k in [false, true] {
                    for b in [false, true] {
                        let p = plan(m, s, k, bundle: b)
                        let label = "marker \(m) state \(String(describing: s)) key \(k) bundle \(b)"
                        if m == .alive || m == .unreadable {
                            XCTAssertEqual(p.keyCleanup, .keep, label)
                            XCTAssertFalse(p.offerTrash, label)
                            XCTAssertFalse(p.removeMarker, label)
                        }
                        if let s, s != .cleanupPending {
                            XCTAssertFalse(p.copyDefaults, label)
                            XCTAssertFalse(p.copyKey, label)
                            XCTAssertEqual(p.keyCleanup, .keep, label)
                            XCTAssertFalse(p.offerTrash, label)
                        }
                        XCTAssertEqual(p.removeMarker, m == .ended, label)
                        if s == .cleanupPending {
                            XCTAssertFalse(p.copyDefaults, label)
                            XCTAssertFalse(p.copyKey, label)
                        }
                        n += 1
                    }
                }
            }
        }
        XCTAssertEqual(n, 80)
    }

    // MARK: needsKeyEvidence — 4 × 5 전 조합

    func testNeedsKeyEvidence() {
        for m in markers {
            for s in allStates {
                let expected: Bool
                switch s {
                case nil: expected = true
                case .cleanupPending?: expected = (m == .absent || m == .ended)
                default: expected = false
                }
                XCTAssertEqual(MigrationPlan.needsKeyEvidence(marker: m, state: s), expected, "marker \(m) state \(String(describing: s))")
            }
        }
    }

    // MARK: record

    func testRecord() {
        let first = plan(.absent, nil, false, bundle: false)
        XCTAssertEqual(MigrationPlan.record(plan: first, keychainCopy: .failed, legacyDefaultsFound: true), .keychainSkipped)
        XCTAssertEqual(MigrationPlan.record(plan: first, keychainCopy: .failed, legacyDefaultsFound: false), .keychainSkipped)
        XCTAssertEqual(MigrationPlan.record(plan: first, keychainCopy: .noLegacyKey, legacyDefaultsFound: false), .nothing)
        XCTAssertEqual(MigrationPlan.record(plan: first, keychainCopy: .noLegacyKey, legacyDefaultsFound: true), .done)
        XCTAssertEqual(MigrationPlan.record(plan: first, keychainCopy: .copied, legacyDefaultsFound: false), .done)
        XCTAssertEqual(MigrationPlan.record(plan: first, keychainCopy: .notNeeded, legacyDefaultsFound: false), .done)
        // 옛 번들이 있으면(휴지통 ○) 복사할 것이 없어도 nothing 이 아니다.
        XCTAssertEqual(MigrationPlan.record(plan: plan(.absent, nil, false), keychainCopy: .noLegacyKey, legacyDefaultsFound: false), .done)
        // 첫 기동·살아 있음 칸 → 키 복사 결과와 무관하게 cleanup-pending.
        for copy in [KeychainCopy.failed, .noLegacyKey, .copied, .notNeeded] {
            XCTAssertEqual(MigrationPlan.record(plan: plan(.alive, nil, false), keychainCopy: copy, legacyDefaultsFound: true), .cleanupPending)
            XCTAssertEqual(MigrationPlan.record(plan: plan(.unreadable, nil, true), keychainCopy: copy, legacyDefaultsFound: false), .cleanupPending)
        }
        // 기록 그대로인 칸은 쓰지 않는다(nil).
        XCTAssertNil(MigrationPlan.record(plan: plan(.alive, .cleanupPending, true), keychainCopy: .notNeeded, legacyDefaultsFound: false))
        XCTAssertNil(MigrationPlan.record(plan: plan(.absent, .cleanupPending, false), keychainCopy: .notNeeded, legacyDefaultsFound: false))
        XCTAssertEqual(MigrationPlan.record(plan: plan(.absent, .cleanupPending, true), keychainCopy: .notNeeded, legacyDefaultsFound: false), .done)
    }

    // MARK: DefaultsCopy

    func testDefaultsCopyKeysToWrite() {
        let old: [String: Any] = ["server": "https://a.example", "lastFolders": ["/x", "/y"], "browserEnabled": true,
                                  "backend": "local", "other": 1, "migration.v1": "done"]
        let writes = DefaultsCopy.keysToWrite(old: old, newHas: { $0 == "backend" })
        XCTAssertEqual(writes.map(\.key).sorted(), ["browserEnabled", "lastFolders", "server"])
        let dict = Dictionary(uniqueKeysWithValues: writes.map { ($0.key, $0.value) })
        XCTAssertEqual(dict["lastFolders"] as? [String], ["/x", "/y"])
        XCTAssertEqual(dict["browserEnabled"] as? Bool, true)
        XCTAssertEqual(dict["server"] as? String, "https://a.example")
        XCTAssertTrue(DefaultsCopy.keysToWrite(old: nil, newHas: { _ in false }).isEmpty)
        XCTAssertTrue(DefaultsCopy.keysToWrite(old: ["other": 1], newHas: { _ in false }).isEmpty)
    }
}
