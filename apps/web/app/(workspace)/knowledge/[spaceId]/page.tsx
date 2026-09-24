// 얇은 라우트 — 상세 화면은 add-on 컴포넌트가 전담한다. params 를 풀어(출처 칩의 ?doc=&chunk=) 넘긴다.
import { SpaceDetail } from "@/addons/knowledge/pages/space-detail";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ spaceId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { spaceId } = await params;
  const sp = await searchParams;
  const docId = typeof sp.doc === "string" ? sp.doc : null;
  const chunkId = typeof sp.chunk === "string" ? sp.chunk : null;
  return <SpaceDetail spaceId={spaceId} docId={docId} chunkId={chunkId} />;
}
