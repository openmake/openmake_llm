// WsChatRequest.chat 빌더 — 채팅 모드는 중립 필드 modes 로만 보낸다(PR-H1-3)
import XCTest
@testable import OpenMakeKit

final class WsChatRequestBuilderTests: XCTestCase {
    private func encodedObject(_ request: WsChatRequest) throws -> [String: Any] {
        let data = try JSONEncoder().encode(request)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testModesAreSentAsNeutralFieldWithoutLegacyBooleans() throws {
        let json = try encodedObject(WsChatRequest.chat(message: "m", modes: ["discussion": true]))
        XCTAssertEqual(json["modes"] as? [String: Bool], ["discussion": true])
        XCTAssertNil(json["discussionMode"])
        XCTAssertNil(json["deepResearchMode"])
    }

    func testNilModesOmitsModesKey() throws {
        let json = try encodedObject(WsChatRequest.chat(message: "m"))
        XCTAssertNil(json["modes"])
        XCTAssertNil(json["discussionMode"])
        XCTAssertNil(json["deepResearchMode"])
    }
}
