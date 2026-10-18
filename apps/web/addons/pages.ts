/**
 * add-on 화면 레지스트리 — 이 빌드에 포함된 add-on 이 소유한 URL. Base 의 catch-all 라우트(`app/(workspace)/[...addonPath]`)가
 * 서버에서 이 파일만 보고 화면을 고르거나 404 를 낸다. 상품 구성에서 add-on 을 빼면 여기서도 빼서 그 화면이 빌드에서 사라지게 한다.
 * 클라이언트 확장(`registry.ts`)과 나눈 이유: 그쪽은 훅을 쓰는 모듈을 끌어와 서버 컴포넌트에서 import 할 수 없다.
 * 서버에서 꺼진 add-on 의 화면은 그대로 렌더되고, 화면이 API 의 404 `ADDON_DISABLED` 를 받아 안내한다(종전 동작).
 */
import type { ReactNode } from "react";
import type { WebAddonPage, WebAddonPageProps } from "./types";
import { deepResearchPages } from "./deep-research/pages";
import { knowledgePages } from "./knowledge/pages";

export const WEB_ADDON_PAGES: readonly WebAddonPage[] = [...deepResearchPages, ...knowledgePages];

/** URL 조각으로 add-on 화면을 찾아 렌더한다 — 맞는 화면이 없으면 null(Base 가 404) */
export function renderAddonPage(
  pathSegments: readonly string[],
  searchParams: WebAddonPageProps["searchParams"],
  pages: readonly WebAddonPage[] = WEB_ADDON_PAGES,
): ReactNode | null {
  const [head, ...segments] = pathSegments;
  const page = pages.find((p) => p.path === head);
  return page ? page.render({ segments, searchParams }) : null;
}
