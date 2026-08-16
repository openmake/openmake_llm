// 첨부 빌더 테스트 (축 3 Step 5)
import XCTest
@testable import OpenMakeKit

final class AttachmentsTests: XCTestCase {
    func testTextAttachmentUnderCap() {
        let file = WsAttachedFile.text(name: "a.txt", content: "hello")
        XCTAssertEqual(file.content, "hello")
        XCTAssertNil(file.truncated)
        XCTAssertNil(file.data)
        XCTAssertEqual(file.type, "text/plain")
    }

    func testTextAttachmentTruncatesOverCap() {
        let long = String(repeating: "가", count: AttachmentLimits.textContentCap + 100)
        let file = WsAttachedFile.text(name: "long.txt", content: long)
        XCTAssertEqual(file.content?.count, AttachmentLimits.textContentCap)
        XCTAssertEqual(file.truncated, true)
    }

    func testBinaryDocumentEncodesBase64() throws {
        let raw = Data([0x25, 0x50, 0x44, 0x46]) // %PDF
        let file = try WsAttachedFile.binaryDocument(name: "doc.pdf", mimeType: "application/pdf", data: raw)
        XCTAssertNil(file.content)
        XCTAssertEqual(file.data, raw.base64EncodedString())
        XCTAssertEqual(file.size, 4)
    }

    func testBinaryDocumentRejectsOversize() {
        let big = Data(count: AttachmentLimits.binaryCapBytes + 1)
        XCTAssertThrowsError(
            try WsAttachedFile.binaryDocument(name: "big.bin", mimeType: "application/octet-stream", data: big))
    }

    func testDataURLEncodeAndMimeDetection() {
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A])
        XCTAssertEqual(DataURL.imageMimeType(of: png), "image/png")
        let jpeg = Data([0xFF, 0xD8, 0xFF])
        XCTAssertEqual(DataURL.imageMimeType(of: jpeg), "image/jpeg")
        let url = DataURL.encode(jpeg, mimeType: "image/jpeg")
        XCTAssertTrue(url.hasPrefix("data:image/jpeg;base64,"))
    }
}
