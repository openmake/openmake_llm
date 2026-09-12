// 멀티모달 오케스트레이터 진행(system_event orchestrator_*) 리듀서 테스트.
// 종전엔 system_event 가 default 로 버려져 이미지·영상 턴에 진행 표시가 0 이었다.
import XCTest
@testable import OpenMakeKit

final class OrchestratorProgressTests: XCTestCase {
    private func event(_ json: String) -> WsServerEvent {
        try! JSONDecoder().decode(WsServerEvent.self, from: json.data(using: .utf8)!)
    }

    private func systemEvent(_ type: String, _ metadata: String) -> WsServerEvent {
        event(#"{"type":"system_event","payload":{"type":"\#(type)","message":"","metadata":\#(metadata)}}"#)
    }

    func testPlanningThenMultiPlanBuildsTaskList() {
        var state = ChatStreamState()
        state.begin()
        state.apply(systemEvent("orchestrator_status", #"{"phase":"planning"}"#))
        XCTAssertEqual(state.orchestrator?.phase, .planning)
        state.apply(systemEvent("orchestrator_plan", #"{"complexity":"multi","tasks":[{"id":"t1","capability":"image.generate","instruction":"A lighthouse"}]}"#))
        XCTAssertEqual(state.orchestrator?.complexity, "multi")
        XCTAssertEqual(state.orchestrator?.tasks.count, 1)
        XCTAssertEqual(state.orchestrator?.tasks.first?.status, .pending)
        XCTAssertEqual(state.orchestrator?.tasks.first?.label, "이미지 생성")
        XCTAssertEqual(state.statusText, "이미지를 생성하고 있어요")
    }

    func testTaskRunningThenOkUpdatesSameId() {
        var state = ChatStreamState()
        state.begin()
        state.apply(systemEvent("orchestrator_plan", #"{"complexity":"multi","tasks":[{"id":"t1","capability":"video.generate"}]}"#))
        state.apply(systemEvent("orchestrator_status", #"{"phase":"executing"}"#))
        state.apply(systemEvent("orchestrator_task", #"{"id":"t1","capability":"video.generate","status":"running"}"#))
        XCTAssertEqual(state.orchestrator?.tasks.first?.status, .running)
        XCTAssertTrue(state.statusText?.contains("영상") == true)
        state.apply(systemEvent("orchestrator_task", #"{"id":"t1","capability":"video.generate","status":"ok","summary":"영상 생성 완료","ms":18073}"#))
        XCTAssertEqual(state.orchestrator?.tasks.count, 1, "같은 id 는 갱신, 추가 아님")
        XCTAssertEqual(state.orchestrator?.tasks.first?.status, .ok)
        XCTAssertEqual(state.orchestrator?.tasks.first?.ms, 18073)
        XCTAssertEqual(state.orchestrator?.doneCount, 1)
        state.apply(systemEvent("orchestrator_status", #"{"phase":"synthesizing","detail":"1/1"}"#))
        XCTAssertEqual(state.orchestrator?.phase, .synthesizing)
        XCTAssertEqual(state.orchestrator?.detail, "1/1")
    }

    func testSimplePlanAndDoneClearBanner() {
        var state = ChatStreamState()
        state.begin()
        state.apply(systemEvent("orchestrator_status", #"{"phase":"planning"}"#))
        state.apply(systemEvent("orchestrator_plan", #"{"complexity":"simple","tasks":[]}"#))
        XCTAssertNil(state.orchestrator, "simple 은 종전 경로 — 배너 없음")
        state.apply(systemEvent("orchestrator_status", #"{"phase":"planning"}"#))
        state.apply(systemEvent("orchestrator_status", #"{"phase":"done","detail":"simple"}"#))
        XCTAssertNil(state.orchestrator)
        state.apply(systemEvent("orchestrator_status", #"{"phase":"executing"}"#))
        state.apply(event(#"{"type":"done","messageId":"m1"}"#))
        XCTAssertNil(state.orchestrator, "done 이면 배너 정리")
    }

    func testUnknownSystemEventIsIgnored() {
        var state = ChatStreamState()
        state.begin()
        let before = state.statusText
        state.apply(systemEvent("model_fallback", #"{"to":"local-llm:qwen"}"#))
        XCTAssertNil(state.orchestrator)
        XCTAssertEqual(state.statusText, before)
        // metadata 형식이 깨져도 crash 없음
        state.apply(systemEvent("orchestrator_task", #"{"id":42,"status":"running"}"#))
        XCTAssertNil(state.orchestrator)
    }
}
