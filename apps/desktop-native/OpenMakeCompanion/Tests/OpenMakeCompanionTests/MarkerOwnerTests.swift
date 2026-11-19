// 교체 진행 표식 소유자 판정(plan-pr2.5 D-157·§4.3) — R-12 r5 전 갈래 + R-12c(시계 변경)·R-12d(PID 재사용).
// 판정 함수 서명에 시각 인자가 없다 — 표식 판정에 수정 시각·나이가 끼어들지 않는 것은 컴파일이 보증한다(R-12 r4·r5).
import XCTest
@testable import OpenMakeCompanion

final class MarkerOwnerTests: XCTestCase {
    private let recorded: Int64 = 1_000_000

    private func judge(_ content: String?, _ lookup: ProcessLookup) -> MarkerOwner.Verdict {
        MarkerOwner.judge(content: content, lookup: { _ in lookup })
    }

    func testMalformedContentIsAliveUnreadable() {
        let bad: [String?] = [nil, "", "\n", "123", "abc 5", "5 abc", "-1 5", "5 -1", "0 5", "5 0", "1 2 3", "1  2", " 1 2",
                              "1 2\n\n", "1 2 ", "99999999999 5"]
        for c in bad {
            // 조회가 "없음" 이어도 내용을 못 읽으면 끝난 것으로 보지 않는다.
            XCTAssertEqual(judge(c, .notFound), .alive(.unreadable), "content \(String(describing: c))")
        }
    }

    func testWellFormedContentIsParsed() {
        XCTAssertEqual(MarkerOwner.parse("123 456")?.pid, 123)
        XCTAssertEqual(MarkerOwner.parse("123 456")?.startTime, 456)
        XCTAssertEqual(MarkerOwner.parse("123 456\n")?.startTime, 456)
        XCTAssertEqual(judge("123 456", .notFound), .ended)
        XCTAssertEqual(judge("123 456\n", .notFound), .ended)
    }

    func testLookupOutcomes() {
        let c = "4242 \(recorded)"
        XCTAssertEqual(judge(c, .notFound), .ended)
        XCTAssertEqual(judge(c, .failed), .alive(.lookupFailed))
        XCTAssertEqual(judge(c, .found(startTime: nil, isBridgeScript: false)), .alive(.startTimeUnknown))
        // 같음(±1초) → 살아 있음 — 정체가 다리 스크립트가 아니어도.
        for d: Int64 in [0, 1, -1] {
            for bridge in [true, false, nil] as [Bool?] {
                XCTAssertEqual(judge(c, .found(startTime: recorded + d, isBridgeScript: bridge)), .alive(.sameProcess), "d=\(d) bridge=\(String(describing: bridge))")
            }
        }
        // 차이 > 1초: 다리 스크립트 → 유예(R-12c), 정체 못 읽음 → 유예, 다리 스크립트 아님 → 끝남(R-12d).
        for d: Int64 in [2, -2, 3600, -86400] {
            XCTAssertEqual(judge(c, .found(startTime: recorded + d, isBridgeScript: true)), .alive(.bridgeScript), "d=\(d)")
            XCTAssertEqual(judge(c, .found(startTime: recorded + d, isBridgeScript: nil)), .alive(.identityUnknown), "d=\(d)")
            XCTAssertEqual(judge(c, .found(startTime: recorded + d, isBridgeScript: false)), .ended, "d=\(d)")
        }
    }

    func testLookupGetsThePidFromContent() {
        var asked: [Int32] = []
        _ = MarkerOwner.judge(content: "777 5", lookup: { asked.append($0); return .notFound })
        XCTAssertEqual(asked, [777])
        // 내용을 못 읽으면 조회하지 않는다.
        _ = MarkerOwner.judge(content: "x", lookup: { asked.append($0); return .notFound })
        XCTAssertEqual(asked, [777])
    }
}
