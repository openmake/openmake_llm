/**
 * 공유된 에이전트 작업 — 읽기 전용 공개 뷰어.
 *
 * `(workspace)` 밖에 두어 사이드바·로그인 게이트 없이 열린다(visibility=link 는 비로그인 방문자가 본다).
 * 화면에 보이는 것은 게시 시점 스냅샷이며, 이후 작업을 이어해도 바뀌지 않는다.
 */
import type { Metadata } from "next";
import { SharedTaskViewer } from "./viewer";

export const metadata: Metadata = {
  title: "공유된 작업 · OpenMake.Ai",
  // 검색엔진 색인 제외 — 링크를 아는 사람만 보는 것이 이 기능의 전제다.
  robots: { index: false, follow: false },
};

export default async function SharedTaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { shareId } = await params;
  const sp = await searchParams;
  const raw = sp.token;
  const token = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] ?? null : null;
  return <SharedTaskViewer shareId={shareId} token={token} />;
}
