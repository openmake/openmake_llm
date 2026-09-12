// 생성 영상·음성 링크 세그먼트 테스트 — 종전 파서는 이미지만 알아 영상/음성 링크가 raw 로 노출됐다.
import XCTest
@testable import OpenMakeKit

final class MarkdownMediaTests: XCTestCase {
    func testVideoAndAudioLinksBecomeSegments() {
        let segments = MarkdownContentParser.segments(
            in: "영상을 완성했습니다.\n\n[🎬 영상 보기](/generated/video-1.webm)\n\n음성도 있어요 [🔊 듣기](/generated/tts-1.wav) 끝.")
        XCTAssertEqual(segments, [
            .text("영상을 완성했습니다.\n\n"),
            .video(title: "🎬 영상 보기", source: "/generated/video-1.webm"),
            .text("\n\n음성도 있어요 "),
            .audio(title: "🔊 듣기", source: "/generated/tts-1.wav"),
            .text(" 끝."),
        ])
    }

    func testOrdinaryLinksStayInline() {
        let segments = MarkdownContentParser.segments(in: "문서는 [여기](https://example.com/doc) 참고, 이미지 ![a](/generated/a.png)")
        XCTAssertEqual(segments, [
            .text("문서는 [여기](https://example.com/doc) 참고, 이미지 "),
            .image(alt: "a", source: "/generated/a.png"),
        ])
    }

    func testMediaKindIgnoresQueryAndCase() {
        XCTAssertEqual(MarkdownContentParser.mediaKind(of: "/generated/x.MP4?v=1"), .video)
        XCTAssertEqual(MarkdownContentParser.mediaKind(of: "/generated/x.mp3"), .audio)
        XCTAssertNil(MarkdownContentParser.mediaKind(of: "/generated/x.pdf"))
        XCTAssertNil(MarkdownContentParser.mediaKind(of: "https://example.com/"))
    }

    func testResolverAcceptsOnlySameOriginGenerated() {
        let server = URL(string: "https://chat.openmake.cc")!
        XCTAssertEqual(
            GeneratedMediaURLResolver.resolve(source: "/generated/v.webm", serverURL: server)?.absoluteString,
            "https://chat.openmake.cc/generated/v.webm")
        XCTAssertNil(GeneratedMediaURLResolver.resolve(source: "https://evil.example/generated/v.webm", serverURL: server))
        XCTAssertNil(GeneratedMediaURLResolver.resolve(source: "/uploads/v.webm", serverURL: server))
    }
}
