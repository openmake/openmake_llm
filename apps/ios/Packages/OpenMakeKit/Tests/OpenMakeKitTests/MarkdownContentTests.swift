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
