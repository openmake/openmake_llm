/**
 * knowledge-runtime add-on (웹) — 사이드바 Knowledge 섹션 + 대화 상단 연결 배너.
 * 목록·상세 페이지는 화면 레지스트리(addons/pages.ts ← pages/index.tsx)에 등록하고 Base 의 catch-all 라우트가 렌더한다.
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
