"use client";

/**
 * 구조화 질문(ask_human `questions`) — 질문마다 선택지를 버튼으로 보여 주고, 고른 답을 답변 글로 엮어 올린다.
 *
 * 승인함(`task-approvals.tsx`)과 채팅 인라인(`chat/message-list.tsx`)이 함께 쓴다. 답변 입력란과 전송 버튼은
 * 호출부의 것을 그대로 쓴다 — 버튼을 누르면 입력란이 채워지고, 사용자는 그 글을 고쳐 쓰거나 선택지 밖의 답을 적을 수 있다.
 * 라벨은 호출부가 번역해 넘긴다.
 */
import { useState } from "react";
import { composeStructuredAnswer, type StructuredQuestion } from "@/lib/hitl-question";

export function QuestionChoices({ intro, questions, disabled, recommendedLabel, onAnswerAction }: {
  intro: string;
  questions: StructuredQuestion[];
  disabled?: boolean;
  recommendedLabel: string;
  /** 고른 답을 엮은 글 — 호출부가 답변 입력란에 넣는다. */
  onAnswerAction: (text: string) => void;
}) {
  const [picks, setPicks] = useState<Record<number, string>>({});
  const pick = (index: number, option: string) => {
    const next = { ...picks, [index]: option };
    setPicks(next);
    onAnswerAction(composeStructuredAnswer(questions, next));
  };
  return (
    <div className="space-y-2">
      {intro && <p className="whitespace-pre-wrap break-words text-sm text-fg">{intro}</p>}
      {questions.map((q, i) => (
        <div key={i} className="space-y-1">
          <p className="whitespace-pre-wrap break-words text-sm text-fg">
            {questions.length > 1 ? `${i + 1}) ` : ""}{q.question}
          </p>
          {q.options && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={disabled}
                  aria-pressed={picks[i] === o}
                  onClick={() => pick(i, o)}
                  className={`rounded-md border px-2.5 py-1 text-xs disabled:opacity-50 ${picks[i] === o ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg hover:bg-surface-2"}`}
                >
                  {o}
                  {q.recommended === o && <span className="ml-1 text-[11px] text-muted">· {recommendedLabel}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
