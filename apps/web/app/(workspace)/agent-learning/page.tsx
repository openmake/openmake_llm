import { redirect } from "next/navigation";

/** 에이전트 학습 대시보드는 관리자 허브(/admin/*) 하위로 이동 (2026-08-26) — 딥링크 호환 redirect. */
export default function AgentLearningRedirect() {
  redirect("/admin/agent-learning");
}
