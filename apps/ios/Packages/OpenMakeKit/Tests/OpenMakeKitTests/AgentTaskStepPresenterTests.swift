import XCTest
@testable import OpenMakeKit

final class AgentTaskStepPresenterTests: XCTestCase {
    func testArtifactStepShowsTitleInsteadOfRawJSON() {
        let raw = #"{"id":"primes-1-to-50","kind":"code","title":"Prime numbers from 1 to 50","lang":"python","content":"def is_prime(n):\n    return n > 1"}"#
        XCTAssertEqual(
            AgentTaskStepPresenter.body(stepType: "artifact", toolName: nil, content: raw),
            "Prime numbers from 1 to 50 · code(python)")
    }

    func testDiffStepShowsChangedFiles() {
        let diff = """
        diff --git a/primes_1_to_50.py b/primes_1_to_50.py
        new file mode 100644
        --- /dev/null
        +++ b/primes_1_to_50.py
        @@ -0,0 +1,2 @@
        +def is_prime(n):
        """
        XCTAssertEqual(
            AgentTaskStepPresenter.body(stepType: "diff", toolName: "git_diff", content: diff),
            "변경 파일: primes_1_to_50.py")
    }

    func testAssistantStepDropsArtifactPlaceholder() {
        let content = "[[artifact:primes-1-to-50]]\n\n실행 결과: [2, 3, 5]"
        XCTAssertEqual(
            AgentTaskStepPresenter.body(stepType: "assistant", toolName: nil, content: content),
            "실행 결과: [2, 3, 5]")
    }

    func testUnparseableArtifactFallsBackToContent() {
        XCTAssertEqual(
            AgentTaskStepPresenter.body(stepType: "artifact", toolName: nil, content: "not json"),
            "not json")
    }

    func testLabelUsesToolNameThenKoreanStepType() {
        XCTAssertEqual(AgentTaskStepPresenter.label(stepType: "tool_result", toolName: "bash"), "bash")
        XCTAssertEqual(AgentTaskStepPresenter.label(stepType: "plan", toolName: nil), "계획")
        XCTAssertEqual(AgentTaskStepPresenter.label(stepType: "unknown_kind", toolName: nil), "unknown_kind")
    }

    func testApprovalDecodesToolArgumentsForSummary() throws {
        let json = """
        {"approvalId":"a1","taskId":"t1","toolName":"bash","args":{"command":"python3 primes.py","timeoutMs":30000}}
        """.data(using: .utf8)!
        let approval = try JSONDecoder().decode(AgentTaskApproval.self, from: json)
        XCTAssertEqual(approval.argumentSummary, "python3 primes.py")
        XCTAssertEqual(approval.args["timeoutMs"], "30000")
    }

    func testApprovalWithoutArgsStaysDecodable() throws {
        let json = #"{"approvalId":"a1","taskId":"t1","toolName":"terminate"}"#.data(using: .utf8)!
        let approval = try JSONDecoder().decode(AgentTaskApproval.self, from: json)
        XCTAssertNil(approval.argumentSummary)
    }

    func testAskHumanQuestionIsSurfaced() throws {
        let json = """
        {"approvalId":"a2","taskId":"t1","toolName":"ask_human","args":{"question":"어느 리전을 쓸까요?"}}
        """.data(using: .utf8)!
        let approval = try JSONDecoder().decode(AgentTaskApproval.self, from: json)
        XCTAssertEqual(approval.argumentSummary, "어느 리전을 쓸까요?")
    }
}
