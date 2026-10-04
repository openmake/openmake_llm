import Foundation

/// ask_human 구조화 질문 한 건 — 서버 `services/task-sandbox/ask-human.ts` 의 AskHumanQuestion 과 짝.
/// 서버는 같은 내용을 줄글로 엮어 `args.question` 에도 넣으므로, 구조를 못 읽으면 줄글 표시로 떨어진다.
public struct AgentTaskQuestion: Sendable, Equatable {
    public let question: String
    public let options: [String]
    /// options 중 하나.
    public let recommended: String?

    public init(question: String, options: [String] = [], recommended: String? = nil) {
        self.question = question
        self.options = options
        self.recommended = recommended
    }

    /// 질문별로 고른 답(질문 순번 → 답)을 답변 글 하나로 엮는다 — 답변 채널은 글 하나다. 질문이 하나면 답 그대로.
    /// 웹 `lib/hitl-question.ts` 의 composeStructuredAnswer 와 같은 모양이어야 모델이 같은 결과를 받는다.
    public static func composeAnswer(questions: [AgentTaskQuestion], picks: [Int: String]) -> String {
        let trimmed = picks.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        if questions.count == 1 { return trimmed[0] ?? "" }
        return questions.indices
            .compactMap { index in trimmed[index].flatMap { $0.isEmpty ? nil : "\(index + 1)) \($0)" } }
            .joined(separator: "; ")
    }
}

/// 승인 인자(`args`)에서 구조화 질문만 읽는 디코더 — 모양이 다르면 통째로 버린다(웹 structuredQuestions 와 같은 규칙).
struct StructuredQuestionArgs: Decodable {
    let questions: [AgentTaskQuestion]
    let intro: String?

    private enum Keys: String, CodingKey { case questions, intro }
    private enum ItemKeys: String, CodingKey { case question, options, recommended }

    /// 글이 아닌 항목은 건너뛰는 선택지 원소.
    private struct LossyString: Decodable {
        let value: String?
        init(from decoder: Decoder) throws {
            value = try? decoder.singleValueContainer().decode(String.self)
        }
    }

    private struct Item: Decodable {
        let parsed: AgentTaskQuestion?
        init(from decoder: Decoder) throws {
            guard let container = try? decoder.container(keyedBy: ItemKeys.self),
                  let question = try? container.decode(String.self, forKey: .question), !question.isEmpty
            else { parsed = nil; return }
            let options = ((try? container.decode([LossyString].self, forKey: .options)) ?? [])
                .compactMap(\.value).filter { !$0.isEmpty }
            let recommended = (try? container.decode(String.self, forKey: .recommended)).flatMap { options.contains($0) ? $0 : nil }
            parsed = AgentTaskQuestion(question: question, options: options, recommended: recommended)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let items = (try? container.decode([Item].self, forKey: .questions)) ?? []
        let parsed = items.compactMap(\.parsed)
        questions = parsed.count == items.count ? parsed : []
        intro = (try? container.decode(String.self, forKey: .intro)).flatMap { $0.isEmpty ? nil : $0 }
    }
}
