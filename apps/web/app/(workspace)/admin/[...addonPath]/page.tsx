// 관리자 영역 add-on 화면의 단일 진입점 — admin/layout.tsx 의 가드가 그대로 감싼다. 화면 레지스트리(addons/pages.ts)에 묻기만 한다.
// 관리자 정적 라우트(/admin/metrics 등)가 이 동적 라우트보다 먼저다.
// 없는 경로의 응답 상태는 200 이다 — 가드 레이아웃이 클라이언트 컴포넌트라 SSR 에서 children 을 그리지 않아, notFound 신호는
// 인증 확인 뒤 클라이언트에서 not-found 화면으로 드러난다(비관리자는 가드 안내만 본다).
import { notFound } from "next/navigation";
import { renderAddonPage } from "@/addons/pages";

export default async function AdminAddonPage({
  params,
  searchParams,
}: {
  params: Promise<{ addonPath: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { addonPath } = await params;
  const page = renderAddonPage(addonPath, await searchParams, undefined, "admin");
  if (!page) notFound();
  return page;
}
