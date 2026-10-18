// 관리자 영역 add-on 화면의 단일 진입점 — 화면 레지스트리(addons/pages.ts)에 묻기만 한다. URL 은 /admin/<path> 이고
// 관리자 정적 라우트(/admin/metrics 등)가 이 동적 라우트보다 먼저다.
// 관리자 가드 레이아웃(app/(workspace)/admin/layout.tsx) 밖 route group 에 두는 이유: 그 가드는 클라이언트 컴포넌트라 SSR 에서
// children 을 그리지 않아, 안에 두면 없는 경로의 notFound() 가 응답 상태에 닿지 않고 200 이 된다. 그래서 화면 유무를 서버에서
// 먼저 판정하고(없으면 404), 있는 화면만 같은 가드로 감싼다.
import { notFound } from "next/navigation";
import { renderAddonPage } from "@/addons/pages";
import { AdminGuard } from "@/components/admin-guard";

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
  return <AdminGuard>{page}</AdminGuard>;
}
