// 마크다운 표 파서 테스트 — 폰 카드 렌더의 입력 계약
import XCTest
@testable import OpenMakeKit

final class MarkdownTableTests: XCTestCase {
    private let sample = [
        "| 상황 | 추천 | 이유 |",
        "|---|---|---|",
        "| 실무 취직 | React | 채용 공고가 많음 |",
        "| 초보자 | Vue | 진입 장벽이 낮음 |",
        "",
        "다음 문단",
    ]

    func testParsesHeadersAndRows() throws {
        let parsed = try XCTUnwrap(MarkdownTableParser.parse(sample, from: 0))
        XCTAssertEqual(parsed.table.headers, ["상황", "추천", "이유"])
        XCTAssertEqual(parsed.table.rows.count, 2)
        XCTAssertEqual(parsed.table.rows[0], ["실무 취직", "React", "채용 공고가 많음"])
        XCTAssertEqual(parsed.consumed, 4, "헤더+구분+데이터 2행만 소비하고 빈 줄에서 멈춘다")
    }

    func testFieldsSkipFirstColumnForCardTitle() throws {
        let parsed = try XCTUnwrap(MarkdownTableParser.parse(sample, from: 0))
        let fields = parsed.table.fields(of: parsed.table.rows[0], skippingFirst: true)
        XCTAssertEqual(fields.map(\.header), ["추천", "이유"])
        XCTAssertEqual(fields.first?.value, "React")
    }

    func testAlignmentDividerIsAccepted() throws {
        let aligned = ["| A | B |", "|:--|--:|", "| 1 | 2 |"]
        let parsed = try XCTUnwrap(MarkdownTableParser.parse(aligned, from: 0))
        XCTAssertEqual(parsed.table.headers, ["A", "B"])
        XCTAssertEqual(parsed.table.rows, [["1", "2"]])
    }

    func testNonTableIsRejected() {
        XCTAssertNil(MarkdownTableParser.parse(["| 파이프만 있고 구분행 없음 |", "본문"], from: 0))
        XCTAssertNil(MarkdownTableParser.parse(["그냥 문단", "또 문단"], from: 0))
        // 헤더+구분행만 있고 데이터가 없으면 표로 보지 않는다
        XCTAssertNil(MarkdownTableParser.parse(["| A | B |", "|---|---|"], from: 0))
    }

    func testEmptyCellsAreDroppedFromFields() throws {
        let sparse = ["| 항목 | 값 | 비고 |", "|---|---|---|", "| A | 1 |  |"]
        let parsed = try XCTUnwrap(MarkdownTableParser.parse(sparse, from: 0))
        let fields = parsed.table.fields(of: parsed.table.rows[0], skippingFirst: true)
        XCTAssertEqual(fields.map(\.header), ["값"], "빈 셀은 카드에 표시하지 않는다")
    }
}
