// add-on 화면의 단일 진입점 — Base 는 어떤 add-on 이 어떤 URL 을 쓰는지 모르고 화면 레지스트리(addons/pages.ts)에 묻기만 한다.
// 정적 라우트가 이 동적 라우트보다 먼저이고, next.config 의 rewrites(배열 = afterFiles)도 먼저라 /api·/generated 는 가리지 않는다.
import { notFound } from "next/navigation";
import { renderAddonPage } from "@/addons/pages";

export default async function AddonPage({
  params,
  searchParams,
}: {
  params: Promise<{ addonPath: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { addonPath } = await params;
  const page = renderAddonPage(addonPath, await searchParams);
  if (!page) notFound();
  return page;
}
