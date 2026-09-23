/**
 * knowledge-runtime add-on (웹) — 사이드바 Knowledge 섹션 + 대화 상단 연결 배너.
 * 목록·상세 페이지는 얇은 라우트(app/(workspace)/knowledge/*)가 이 디렉터리의 컴포넌트를 렌더한다.
 * 서버에서 꺼진 경우 useEnabledWebAddons 가 걸러 사이드바 섹션·배너가 사라진다.
 */
import type { WebAddon } from "../types";
import { KNOWLEDGE_ADDON_ID } from "./constants";
import { KnowledgeSidebarSection } from "./components/sidebar-section";
import { KnowledgeChatBanner } from "./components/chat-banner";

export const knowledgeAddon: WebAddon = {
  id: KNOWLEDGE_ADDON_ID,
  sidebarSections: [{ id: KNOWLEDGE_ADDON_ID, order: 10, Component: KnowledgeSidebarSection }],
  chatContextBanners: [{ order: 10, Component: KnowledgeChatBanner }],
};
