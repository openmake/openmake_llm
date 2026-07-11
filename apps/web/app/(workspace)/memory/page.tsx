import { redirect } from "next/navigation";

/** 메모리 관리는 설정 '메모리' 탭으로 흡수됨 (2026-07-11 사이드바 통폐합) — 딥링크 호환 redirect. */
export default function MemoryRedirect() {
  redirect("/settings?tab=memory");
}
