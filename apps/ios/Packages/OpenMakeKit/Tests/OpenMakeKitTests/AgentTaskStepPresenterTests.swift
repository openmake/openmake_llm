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
        XCTAssertTrue(approval.isQuestion)
    }

    func testMcpElicitIsQuestionWithServerMessage() throws {
        let json = """
        {"approvalId":"a3","taskId":"t1","toolName":"mcp_elicit","args":{"server":"open-design","question":"프로젝트 이름?","requestedSchema":{"type":"object","properties":{"name":{"type":"string"}}}}}
        """.data(using: .utf8)!
        let approval = try JSONDecoder().decode(AgentTaskApproval.self, from: json)
        XCTAssertTrue(approval.isQuestion)
        XCTAssertEqual(approval.argumentSummary, "프로젝트 이름?")
        XCTAssertEqual(approval.args["server"], "open-design")
        XCTAssertFalse(AgentTaskApproval(id: "a4", taskId: "t1", toolName: "bash").isQuestion)
    }

    // MARK: - 구조화 질문 (서버 services/task-sandbox/ask-human.ts 의 questions)

    func testAskHumanStructuredQuestionsDecode() throws {
        let json = #"""
        {"approvalId":"a5","taskId":"t1","toolName":"ask_human","args":{"question":"배포 전 확인\n1) 어느 리전을 쓸까요? — 선택지: 서울 / 도쿄 (권장: 서울)\n2) 예산 상한은요?","intro":"배포 전 확인","questions":[{"question":"어느 리전을 쓸까요?","options":["서울","도쿄"],"recommended":"서울"},{"question":"예산 상한은요?"}]}}
        """#.data(using: .utf8)!
        let approval = try JSONDecoder().decode(AgentTaskApproval.self, from: json)
        XCTAssertEqual(approval.questions, [
            AgentTaskQuestion(question: "어느 리전을 쓸까요?", options: ["서울", "도쿄"], recommended: "서울"),
            AgentTaskQuestion(question: "예산 상한은요?"),
        ])
        XCTAssertEqual(approval.intro, "배포 전 확인")
        // 줄글도 그대로 남는다 — 구조를 못 읽는 경우의 표시
        XCTAssertEqual(approval.argumentSummary?.components(separatedBy: "\n").first, "배포 전 확인")
    }

    func testAskHumanWithoutStructureKeepsProseOnly() throws {
        let json = #"{"approvalId":"a6","taskId":"t1","toolName":"ask_human","args":{"question":"진행할까요?"}}"#.data(using: .utf8)!
        let approval = try JSONDecoder().decode(AgentTaskApproval.self, from: json)
        XCTAssertTrue(approval.questions.isEmpty)
        XCTAssertNil(approval.intro)
        XCTAssertEqual(approval.argumentSummary, "진행할까요?")
    }

    func testMalformedStructureFallsBackToProse() throws {
        // 질문 글이 없는 항목이 섞이면 구조 전체를 버린다(웹 structuredQuestions 와 같은 규칙)
        let json = #"{"approvalId":"a7","taskId":"t1","toolName":"ask_human","args":{"question":"줄글","questions":[{"question":"q1","options":["a"]},{"options":["b"]}]}}"#.data(using: .utf8)!
        let approval = try JSONDecoder().decode(AgentTaskApproval.self, from: json)
        XCTAssertTrue(approval.questions.isEmpty)
        XCTAssertEqual(approval.argumentSummary, "줄글")
        // 배열이 아닌 questions 도 승인 디코딩을 깨지 않는다
        let odd = #"{"approvalId":"a8","taskId":"t1","toolName":"ask_human","args":{"question":"줄글","questions":"x"}}"#.data(using: .utf8)!
        XCTAssertTrue(try JSONDecoder().decode(AgentTaskApproval.self, from: odd).questions.isEmpty)
    }

    func testStructureIgnoredForOtherToolsAndBadRecommendation() throws {
        let other = #"{"approvalId":"a9","taskId":"t1","toolName":"bash","args":{"command":"ls","questions":[{"question":"q"}]}}"#.data(using: .utf8)!
        XCTAssertTrue(try JSONDecoder().decode(AgentTaskApproval.self, from: other).questions.isEmpty)
        let bad = #"{"approvalId":"a10","taskId":"t1","toolName":"ask_human","args":{"questions":[{"question":"q","options":["a","",3],"recommended":"z"}]}}"#.data(using: .utf8)!
        XCTAssertEqual(try JSONDecoder().decode(AgentTaskApproval.self, from: bad).questions, [AgentTaskQuestion(question: "q", options: ["a"])])
    }

    func testComposeStructuredAnswerMatchesWeb() {
        let region = AgentTaskQuestion(question: "리전?", options: ["서울", "도쿄"], recommended: "서울")
        let budget = AgentTaskQuestion(question: "예산?")
        XCTAssertEqual(AgentTaskQuestion.composeAnswer(questions: [region], picks: [0: "서울"]), "서울")
        XCTAssertEqual(AgentTaskQuestion.composeAnswer(questions: [region, budget], picks: [0: "서울", 1: "월 100만원"]), "1) 서울; 2) 월 100만원")
        XCTAssertEqual(AgentTaskQuestion.composeAnswer(questions: [region, budget], picks: [1: " 100 "]), "2) 100")
    }
}
