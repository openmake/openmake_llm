// ChatStreamState 리듀서 테스트 (축 3 Step 4)
import XCTest
@testable import OpenMakeKit

final class ChatStreamStateTests: XCTestCase {
    private func event(_ json: String) -> WsServerEvent {
        try! JSONDecoder().decode(WsServerEvent.self, from: json.data(using: .utf8)!)
    }

    func testTokenAccumulationEndsThinking() {
        var state = ChatStreamState()
        state.begin()
        XCTAssertEqual(state.statusText, "요청을 분석하고 있어요")
        state.apply(event(#"{"type":"thinking","token":"…"}"#))
        XCTAssertTrue(state.isThinking)
        XCTAssertEqual(state.statusText, "답변을 생각하고 있어요")
        state.apply(event(#"{"type":"token","token":"안녕"}"#))
        state.apply(event(#"{"type":"token","token":"하세요"}"#))
        XCTAssertEqual(state.streamingText, "안녕하세요")
        XCTAssertFalse(state.isThinking)
    }

    func testBeginHintExplainsLongRunningModes() {
        var state = ChatStreamState()
        state.begin(hint: "이미지를 생성하고 있어요 (최대 1분)")
        XCTAssertEqual(state.statusText, "이미지를 생성하고 있어요 (최대 1분)")
        XCTAssertFalse(state.isDone)
    }

    func testStreamWithoutDoneStaysIncomplete() {
        // done 이 오기 전 연결이 끊기면 isDone 은 false 로 남아야 한다
        // (호출자가 이 조건으로 "응답 중단" 을 사용자에게 알린다 — 조용한 실패 방지)
        var state = ChatStreamState()
        state.begin()
        state.apply(event(#"{"type":"token","token":"부분"}"#))
        XCTAssertFalse(state.isDone)
        XCTAssertEqual(state.streamingText, "부분")
        XCTAssertNil(state.errorMessage)
    }

    func testSessionCreatedAdoptsId() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"session_created","sessionId":"s-new"}"#))
        XCTAssertEqual(state.sessionId, "s-new")
    }

    func testDoneCarriesMetrics() {
        var state = ChatStreamState()
        state.begin()
        state.apply(event(#"{"type":"done","messageId":"m1","cleanedContent":"정리된 답변","metrics":{"tokenCount":42,"tokensPerSec":"12.50"}}"#))
        XCTAssertTrue(state.isDone)
        XCTAssertEqual(state.streamingText, "정리된 답변")
        XCTAssertNil(state.statusText)
        XCTAssertEqual(state.metrics, ChatStreamMetrics(tokenCount: 42, tokensPerSec: "12.50"))
    }

    func testErrorEndsStreamWithMessage() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"error","message":"백엔드 오류"}"#))
        XCTAssertTrue(state.isDone)
        XCTAssertEqual(state.errorMessage, "백엔드 오류")
    }

    func testAbortedEndsStream() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"aborted"}"#))
        XCTAssertTrue(state.isDone)
    }

    func testTokenWarningFlagsRefresh() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"token_warning","message":"만료 임박"}"#))
        XCTAssertTrue(state.needsTokenRefresh)
        XCTAssertFalse(state.isDone)
    }

    func testIrrelevantEventsAreNoops() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"build_id","buildId":"b1"}"#))
        XCTAssertEqual(state.streamingText, "")
        XCTAssertFalse(state.isDone)
    }

    func testAgentAndResearchEventsExposeOneSafeActivityLine() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"agent_selected","agent":{"name":"Researcher","type":"researcher"}}"#))
        XCTAssertEqual(state.statusText, "Researcher 에이전트가 작업을 준비하고 있어요")
        XCTAssertEqual(state.activityKind, .agent)

        state.apply(event(#"{"type":"research_progress","message":"자료를 찾는 중\n  2 / 5"}"#))
        XCTAssertEqual(state.statusText, "자료를 찾는 중 2 / 5")
        XCTAssertEqual(state.activityKind, .research)
    }

    func testActivatedSkillsAreVisibleUntilNextQuestion() {
        var state = ChatStreamState()
        state.begin()
        state.apply(event(#"{"type":"skills_activated","skillNames":[" web-search ","report","web-search",""]}"#))

        XCTAssertEqual(state.activeSkillNames, ["web-search", "report"])
        XCTAssertEqual(state.statusText, "web-search, report 적용 중")
        XCTAssertEqual(state.activityKind, .agent)

        // 본문이 오기 시작하면 상태는 "작성 중" 으로 바뀐다 (비우면 화면이 정적이 되어 멈춘 것처럼 보임)
        state.apply(event(#"{"type":"token","token":"결과"}"#))
        XCTAssertEqual(state.statusText, "응답을 작성하고 있어요")
        XCTAssertEqual(state.activeSkillNames, ["web-search", "report"])

        state.begin()
        XCTAssertTrue(state.activeSkillNames.isEmpty)
        XCTAssertEqual(state.activityLog.count, 1, "새 질문은 이력을 초기화한다")
    }

    func testAbortMarksWasAbortedForNotice() {
        var state = ChatStreamState()
        state.begin()
        state.apply(event(#"{"type":"aborted"}"#))
        XCTAssertTrue(state.isDone)
        XCTAssertTrue(state.wasAborted, "중단은 오류가 아니라 안내로 구분해 표시한다")
        XCTAssertNil(state.errorMessage)
    }

    func testActivityLogAccumulatesDistinctSteps() {
        var state = ChatStreamState()
        state.begin()
        state.apply(event(#"{"type":"agent_selected","agent":{"name":"Researcher","type":"researcher"}}"#))
        state.apply(event(#"{"type":"mcp_tool_start","toolName":"web_search"}"#))
        state.apply(event(#"{"type":"mcp_tool_start","toolName":"web_search"}"#)) // 중복 — 이력 증가 없음
        state.apply(event(#"{"type":"token","token":"답"}"#))

        let texts = state.activityLog.map(\.text)
        XCTAssertEqual(texts.first, "요청을 분석하고 있어요")
        XCTAssertEqual(texts.last, "응답을 작성하고 있어요")
        XCTAssertEqual(texts.count, Set(texts).count, "연속 중복 단계는 이력에 쌓이지 않는다")
    }

    func testAgentTaskProgressUsesStepPreviewWithoutMultilineOutput() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"agent_task_progress","taskId":"task-1","currentTurn":2,"status":"running","step":{"stepType":"tool_result","toolName":"web_search","preview":"공식 문서를\n확인했어요"}}"#))
        XCTAssertEqual(state.statusText, "공식 문서를 확인했어요")
        XCTAssertEqual(state.activityKind, .agent)
    }

    func testArtifactLifecycleAccumulatesContent() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"artifact_start","artifact":{"id":"a1","kind":"code","lang":"swift","title":"Sample.swift"}}"#))
        state.apply(event(#"{"type":"artifact_chunk","id":"a1","delta":"let answer = "}"#))
        state.apply(event(#"{"type":"artifact_chunk","id":"a1","delta":"42"}"#))
        XCTAssertEqual(state.artifacts.first?.content, "let answer = 42")
        XCTAssertFalse(state.artifacts.first?.isComplete ?? true)

        state.apply(event(#"{"type":"artifact_end","id":"a1"}"#))
        XCTAssertTrue(state.artifacts.first?.isComplete ?? false)
        XCTAssertEqual(state.statusText, "답변을 정리하고 있어요")
    }
}
