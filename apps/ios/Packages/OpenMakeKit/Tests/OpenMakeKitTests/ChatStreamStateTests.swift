// ChatStreamState 리듀서 테스트 (축 3 Step 4)
import XCTest
@testable import OpenMakeKit

final class ChatStreamStateTests: XCTestCase {
    private func event(_ json: String) -> WsServerEvent {
        try! JSONDecoder().decode(WsServerEvent.self, from: json.data(using: .utf8)!)
    }

    func testTokenAccumulationEndsThinking() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"thinking","token":"…"}"#))
        XCTAssertTrue(state.isThinking)
        state.apply(event(#"{"type":"token","token":"안녕"}"#))
        state.apply(event(#"{"type":"token","token":"하세요"}"#))
        XCTAssertEqual(state.streamingText, "안녕하세요")
        XCTAssertFalse(state.isThinking)
    }

    func testSessionCreatedAdoptsId() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"session_created","sessionId":"s-new"}"#))
        XCTAssertEqual(state.sessionId, "s-new")
    }

    func testDoneCarriesMetrics() {
        var state = ChatStreamState()
        state.apply(event(#"{"type":"done","messageId":"m1","metrics":{"tokenCount":42,"tokensPerSec":"12.50"}}"#))
        XCTAssertTrue(state.isDone)
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
        state.apply(event(#"{"type":"skills_activated","skillNames":["a"]}"#))
        XCTAssertEqual(state.streamingText, "")
        XCTAssertFalse(state.isDone)
    }
}
