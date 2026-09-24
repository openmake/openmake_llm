// 모델 배정 응답 디코딩·슬롯 그룹 + 서브에이전트 응답 디코딩 테스트
import XCTest
@testable import OpenMakeKit

final class CapabilityCatalogTests: XCTestCase {
    func testModelAssignmentsDecodeAndGroup() throws {
        let json = #"{"slots":[{"id":"planner","group":"multimodal","kind":"text","roles":["planner"],"capabilities":[],"paramKeys":[],"available":true},{"id":"agent","group":"agents","kind":"text","roles":["agent"],"capabilities":[],"paramKeys":[],"available":true},{"id":"code","group":"quality","kind":"text","roles":["review"],"capabilities":["text.code"],"paramKeys":["temperature"],"available":true}],"assignments":[{"slot":"code","fullId":"hasa:glm-4.7-flash","params":{},"updatedAt":"2026-09-24T00:00:00Z"}],"effective":[{"slot":"code","fullId":"hasa:glm-4.7-flash","source":"user"},{"slot":"agent","fullId":null,"source":"none","error":"x"}]}"#
        let data = try JSONDecoder().decode(ModelAssignments.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(data.grouped().map(\.group), ["agents", "quality", "multimodal"])
        XCTAssertEqual(data.assignment(for: "code")?.fullId, "hasa:glm-4.7-flash")
        XCTAssertEqual(data.effective(for: "agent")?.error, "x")
        XCTAssertEqual(ModelSlotCatalog.title("code"), "코드·리뷰")
        XCTAssertEqual(ModelSlotCatalog.title("future.slot"), "future.slot")
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
