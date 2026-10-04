import OpenMakeKit
import SwiftUI

/// 구조화 질문(ask_human `questions`) — 질문마다 선택지를 버튼으로 보여 주고, 고른 답을 답변 글로 엮어 넘긴다.
/// 웹 `components/approvals/question-choices.tsx` 와 같은 방식: 버튼을 누르면 호출부의 답변 입력란이 채워지고,
/// 사용자는 그 글을 고쳐 쓰거나 선택지 밖의 답을 적을 수 있다. 전송 버튼은 호출부의 것을 그대로 쓴다.
struct AgentTaskQuestionChoices: View {
    let intro: String?
    let questions: [AgentTaskQuestion]
    /// 고른 답을 엮은 글 — 호출부가 답변 입력란에 넣는다.
    let onAnswer: (String) -> Void
    @State private var picks: [Int: String] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let intro {
                Text(intro)
                    .font(.system(size: 14))
                    .foregroundStyle(Instrument.fg2)
            }
            ForEach(Array(questions.enumerated()), id: \.offset) { index, item in
                VStack(alignment: .leading, spacing: 6) {
                    Text(questions.count > 1 ? "\(index + 1)) \(item.question)" : item.question)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Instrument.fg)
                        .textSelection(.enabled)
                    ForEach(item.options, id: \.self) { option in
                        optionButton(option, index: index, recommended: item.recommended == option)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Instrument.bg, in: RoundedRectangle(cornerRadius: 10))
    }

    private func optionButton(_ option: String, index: Int, recommended: Bool) -> some View {
        let selected = picks[index] == option
        return Button {
            picks[index] = option
            onAnswer(AgentTaskQuestion.composeAnswer(questions: questions, picks: picks))
        } label: {
            HStack(spacing: 6) {
                Text(option)
                    .font(.system(size: 14))
                    .multilineTextAlignment(.leading)
                if recommended {
                    Text("권장")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(selected ? Instrument.accent : Instrument.muted)
                }
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .semibold))
                }
            }
            .foregroundStyle(selected ? Instrument.accent : Instrument.fg)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Instrument.accentSoft : Instrument.surface, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(selected ? Instrument.accent : Instrument.border))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(recommended ? "\(option), 권장" : option)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
