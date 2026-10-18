/**
 * Knowledge 화면 경로 — `/knowledge`(목록)·`/knowledge/<spaceId>`(상세, 출처 칩의 `?doc=&chunk=`).
 * 서버에서 import 되므로 훅을 두지 않는다(화면 컴포넌트는 "use client").
 */
import type { WebAddonPage } from "../../types";
import { SpaceDetail } from "./space-detail";
import { SpaceListView } from "./space-list";

const single = (v: string | string[] | undefined): string | null => (typeof v === "string" ? v : null);

export const knowledgePages: readonly WebAddonPage[] = [
  {
    path: "knowledge",
    render({ segments, searchParams }) {
      if (segments.length === 0) return <SpaceListView />;
      if (segments.length > 1) return null;
      return <SpaceDetail spaceId={segments[0]} docId={single(searchParams.doc)} chunkId={single(searchParams.chunk)} />;
    },
  },
];
