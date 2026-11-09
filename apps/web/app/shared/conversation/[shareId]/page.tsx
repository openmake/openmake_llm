/**
 * 공유된 대화 — 읽기 전용 공개 뷰어(198).
 *
 * `(workspace)` 밖에 두어 사이드바·로그인 게이트 없이 열린다(link 는 비로그인 방문자가 본다).
 * 메타에는 제목·본문을 넣지 않는다. 캐시·레퍼러·색인 헤더는 next.config.ts 의 `/shared/conversation` 항목이 붙인다.
 */
import type { Metadata } from "next";
import { SharedConversationViewer } from "./viewer";

export const metadata: Metadata = {
  title: "공유된 대화 · OpenMake.Ai",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function SharedConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { shareId } = await params;
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : null;
  return <SharedConversationViewer shareId={shareId} token={token} />;
}
