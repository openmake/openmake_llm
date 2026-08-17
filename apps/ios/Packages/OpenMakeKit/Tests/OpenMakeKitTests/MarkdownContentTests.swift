import XCTest
@testable import OpenMakeKit

final class MarkdownContentTests: XCTestCase {
    func testParserSeparatesGeneratedImageFromSurroundingMarkdown() {
        let segments = MarkdownContentParser.segments(
            in: "요청하신 이미지입니다.\n\n![푸른 산](/generated/mountain.png)\n\n완료했어요.")

        XCTAssertEqual(segments, [
            .text("요청하신 이미지입니다.\n\n"),
            .image(alt: "푸른 산", source: "/generated/mountain.png"),
            .text("\n\n완료했어요."),
        ])
    }

    func testParserLeavesMalformedImageAsText() {
        let source = "![미완성](/generated/file.png"
        XCTAssertEqual(MarkdownContentParser.segments(in: source), [.text(source)])
    }

    func testGeneratedImageURLStaysOnOpenMakeOrigin() {
        let serverURL = URL(string: "https://chat.openmake.cc")!

        XCTAssertEqual(
            GeneratedImageURLResolver.resolve(
                source: "/generated/image.png",
                serverURL: serverURL)?.absoluteString,
            "https://chat.openmake.cc/generated/image.png")
        XCTAssertNil(GeneratedImageURLResolver.resolve(
            source: "https://example.com/image.png",
            serverURL: serverURL))
        XCTAssertNil(GeneratedImageURLResolver.resolve(
            source: "http://127.0.0.1/generated/image.png",
            serverURL: serverURL))
        XCTAssertNil(GeneratedImageURLResolver.resolve(
            source: "/api/private",
            serverURL: serverURL))
    }
}

final class ArtifactPlaceholderTests: XCTestCase {
    func testStripsPlaceholderAndCollapsesBlankLine() {
        let content = "결론입니다.\n\n[[artifact:k8s-swarm-comparison]]\n\n자세한 내용은 카드에 있습니다."
        let cleaned = MarkdownContentParser.strippingArtifactPlaceholders(content)
        XCTAssertFalse(cleaned.contains("[[artifact:"))
        XCTAssertTrue(cleaned.contains("결론입니다."))
        XCTAssertTrue(cleaned.contains("자세한 내용은"))
        XCTAssertFalse(cleaned.contains("\n\n\n"), "연속 빈 줄이 남지 않는다")
    }

    func testVersionedPlaceholderAlsoStripped() {
        let cleaned = MarkdownContentParser.strippingArtifactPlaceholders("본문 [[artifact:report:v2]] 끝")
        XCTAssertEqual(cleaned, "본문  끝")
    }

    func testContentWithoutPlaceholderIsUnchanged() {
        let content = "표\n| A | B |\n|---|---|\n| 1 | 2 |"
        XCTAssertEqual(MarkdownContentParser.strippingArtifactPlaceholders(content), content)
    }
}
