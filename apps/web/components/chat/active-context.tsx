"use client";

import { useAppStore } from "@/lib/store";

/**
 * 채팅창(컴포저) 위에 표시되는 활성 컨텍스트 바.
 * 백엔드 ws 의 agent_selected / skills_activated 로 채워진 store 의 activeAgent·activeSkills 를 보여준다.
 * (사용자 질문에 답할 때 라우팅된 에이전트 + 주입된 스킬)
 */
export function ActiveContext() {
  const activeAgent = useAppStore((s) => s.activeAgent);
  const activeSkills = useAppStore((s) => s.activeSkills);

  if (!activeAgent && activeSkills.length === 0) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 px-4 pb-2 text-xs">
      {activeAgent && (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 font-medium text-accent">
          <span>{activeAgent.emoji || "🤖"}</span>
          {activeAgent.name}
        </span>
      )}
      {activeSkills.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 font-medium text-muted"
        >
          <span>🛠</span>
          {s}
        </span>
      ))}
    </div>
  );
}
