// capability 그룹 해석 + 서브에이전트 응답 디코딩 테스트
import XCTest
@testable import OpenMakeKit

final class CapabilityCatalogTests: XCTestCase {
    private let assignable = [
        "text.reason", "text.code", "text.embed", "vision.describe", "vision.ocr",
        "image.generate", "image.edit", "audio.transcribe", "audio.speech", "audio.analyze",
        "music.analyze", "music.generate", "video.generate", "video.analyze",
    ]

    func testGroupsForUserHideAdminAndUnsupported() {
        let r = CapabilityCatalog.resolveGroups(assignable: assignable, admin: false)
        XCTAssertEqual(r.groups.map(\.id), ["text", "code", "image", "audio", "music", "video"])
        XCTAssertEqual(r.hiddenUnsupported, ["audio.analyze", "music.analyze", "video.analyze"])
        XCTAssertTrue(r.groups.first { $0.id == "music" }!.isUnsupported)
        XCTAssertFalse(r.groups.first { $0.id == "image" }!.isUnsupported)
    }

    func testAdminSeesEmbedGroup() {
        let r = CapabilityCatalog.resolveGroups(assignable: assignable, admin: true)
        XCTAssertTrue(r.groups.contains { $0.id == "embed" && $0.members == ["text.embed"] })
    }

    func testUnknownCapabilityFallsToOther() {
        let r = CapabilityCatalog.resolveGroups(assignable: ["text.reason", "future.thing"], admin: false)
        XCTAssertEqual(r.groups.last?.id, "other")
        XCTAssertEqual(r.groups.last?.members, ["future.thing"])
        XCTAssertEqual(CapabilityCatalog.label("future.thing"), "future.thing")
    }

    func testSubagentTraceDecodesAndNames() throws {
        let json = #"{"traces":[{"traceId":"tr1","origin":"spawn_agents","subIndex":1,"label":null,"status":"running","startedAt":"2026-09-12T00:00:00Z","finishedAt":null,"steps":[{"seq":1,"type":"tool_call","tool":"web_search","content":null,"at":"2026-09-12T00:00:01Z"}]},{"traceId":"tr2","origin":"delegate","subIndex":0,"label":"법률 검토","status":"completed","startedAt":"2026-09-12T00:00:00Z","finishedAt":"2026-09-12T00:01:00Z","steps":[]}]}"#
        struct Payload: Decodable { let traces: [SubagentTrace] }
        let payload = try JSONDecoder().decode(Payload.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(payload.traces.count, 2)
        XCTAssertEqual(payload.traces[0].displayName, "병렬 서브 #2")
        XCTAssertTrue(payload.traces[0].isActive)
        XCTAssertEqual(payload.traces[0].statusLabel, "실행 중")
        XCTAssertEqual(payload.traces[1].displayName, "법률 검토")
        XCTAssertFalse(payload.traces[1].isActive)
    }
}
