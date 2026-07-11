import { redirect } from "next/navigation";

/** 외부 LLM 키 관리는 설정 '모델' 탭으로 흡수됨 (2026-07-11 사이드바 통폐합) — 딥링크 호환 redirect. */
export default function ApiKeysRedirect() {
  redirect("/settings?tab=model");
}
