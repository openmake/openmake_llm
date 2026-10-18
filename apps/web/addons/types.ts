/**
 * 웹 add-on 확장 계약 — 통합형 add-on 이 Base UI 에 끼어드는 지점 (2026-09-19).
 *
 * Base 컴포넌트(마크다운·컴포저·시스템 설정·API 접근)는 특정 add-on 을 모르고 레지스트리(`addons/registry.ts`)를
 * 순회할 뿐이다. add-on 고유 컴포넌트·블록 형식·스코프 이름은 `addons/<id>/` 에만 둔다.
 * Next.js 는 빌드 시점에 묶으므로 "설치하면 UI 가 생기는" 런타임 플러그인은 아니다 — 켜짐 여부는 서버
 * `GET /api/addons` 로 판정해 숨기고, 상품 구성에서 빼려면 레지스트리에서 그 add-on 을 제외해 빌드한다.
 */
import type { ComponentType, ReactNode } from "react";

/** 메시지 본문에서 add-on 이 가져가 직접 렌더하는 블록 */
export interface MessageBlockExtension {
  /** 닫힌 블록을 찾는 전역(g) 정규식 — 스트리밍 중 미닫힘 블록은 매칭되지 않아 원문이 유지된다 */
  pattern: RegExp;
  /** 매치를 렌더한다. null 이면(본문 파싱 실패 등) 그 구간은 원문 텍스트로 남는다 */
  render(match: RegExpExecArray): ReactNode | null;
  /** 남은 텍스트에서 지울 안내 마커 (도구가 실어 보내는 표시용 문구 등) */
  stripFromText?: RegExp;
}

export interface ContextRef {
  id: string;
  title: string;
}

/** 컴포저 "도구" 시트의 컨텍스트 선택 항목 — 고른 참조는 채팅 요청의 contextRefs[addonId] 로 간다 */
export interface ComposerContextExtension {
  Icon: ComponentType<{ className?: string }>;
  /** `composer` 네임스페이스의 메뉴 라벨 키 */
  labelKey: string;
  /** 선택 칩 + 팝오버. suppressed = 이 턴에 컨텍스트가 적용되지 않는 모드(흐림 표시) */
  Picker: ComponentType<{
    value: ContextRef | null;
    onChange: (v: ContextRef | null) => void;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    suppressed?: boolean;
  }>;
}

/** 관리자 시스템 설정 화면의 설정 그룹 (서버 기여 설정의 group 과 같은 이름, 라벨은 i18n `groups.<group>`) */
export interface SettingsGroupExtension {
  group: string;
  Icon: ComponentType<{ className?: string }>;
}

/** API 키 발급 화면의 스코프 프리셋 (라벨·힌트는 i18n `scope.<id>`·`scope.hint.<id>`) */
export interface ApiKeyScopePresetExtension {
  id: string;
  scopes: readonly string[];
}

/**
 * 채팅 모드 — 켜면 백엔드가 일반 채팅 대신 그 모드의 전용 파이프라인으로 턴을 처리한다(일반 도구·아티팩트 미적용).
 * 모드끼리, 그리고 에이전트 작업 모드와 상호배타다. 요청에는 `modes[<addonId>] = true` 로 실린다.
 */
export interface ChatModeExtension {
  Icon: ComponentType<{ className?: string }>;
  /** `composer` 네임스페이스의 토글 라벨 키 */
  labelKey: string;
  /** 토글 시트·칩에서의 자리 — Base 토글(생각 20 · 답변 검증 30 · 에이전트 50) 사이에 끼운다 */
  toggleOrder: number;
  /** 분석 이벤트의 chat_mode 값 */
  analyticsName: string;
  /** 진행 이벤트의 WS type (서버의 그 모드가 선언한 이름과 같다) */
  progressEventType: string;
  /** WS 진행 이벤트의 progress → 배너에 넘길 값 (범위 보정 등) */
  toProgress(raw: Record<string, unknown>): unknown;
  /** 생성 중 메시지 목록 아래에 뜨는 진행 배너 */
  ProgressBanner: ComponentType<{ progress: unknown }>;
}

/**
 * 사이드바 섹션 — 주요 메뉴와 최근 대화 사이에 add-on 이 동적 목록을 끼운다(메뉴 항목 추가가 아니다).
 * 여러 add-on 이 기여하면 order 오름차순으로 쌓는다.
 */
export interface SidebarSectionProps {
  /** 사이드바 검색어(정규화 전 원문) — 섹션이 자기 항목을 거를 때 쓴다 */
  query: string;
  /** 지금 열린 대화 */
  currentSessionId: string | null;
  /** Base 의 대화 열기(메시지 로드 + 채팅 화면 전환)를 그대로 쓴다 */
  openSession(sessionId: string): void;
}
export interface SidebarSectionExtension {
  id: string;
  order: number;
  Component: ComponentType<SidebarSectionProps>;
}

/** 대화 상단 배너 — 열린 대화의 서버 측 연결 상태를 보여 준다(표시일 뿐 권한 근거가 아니다) */
export interface ChatContextBannerExtension {
  order: number;
  Component: ComponentType<{ sessionId: string | null }>;
}

export interface WebAddon {
  /** 서버 add-on id (`GET /api/addons`) */
  id: string;
  messageBlocks?: readonly MessageBlockExtension[];
  composerContext?: ComposerContextExtension;
  chatMode?: ChatModeExtension;
  settingsGroups?: readonly SettingsGroupExtension[];
  apiKeyScopePresets?: readonly ApiKeyScopePresetExtension[];
  sidebarSections?: readonly SidebarSectionExtension[];
  chatContextBanners?: readonly ChatContextBannerExtension[];
  hubTabs?: readonly HubTabExtension[];
  approvalSections?: readonly ApprovalSectionExtension[];
  settingsTabs?: readonly SettingsTabExtension[];
  adminQuickLinks?: readonly AdminQuickLinkExtension[];
  /** 입력창 `/` 메뉴 — 켜진 add-on 중 첫 번째 것만 쓴다 */
  slashMenu?: SlashMenuExtension;
}

/** 승인함(/approvals) 섹션 — Base 섹션(에이전트 작업 10 · Custom Agent 40) 사이에 순서 값으로 들어간다 */
export interface ApprovalSectionExtension {
  id: string;
  order: number;
  Icon: ComponentType<{ className?: string }>;
  /** next-intl 전체 키 */
  titleKey: string;
  hintKey: string;
  Component: ComponentType<{ onRefreshAction: () => void }>;
  /**
   * 사이드바 승인 배지에 더할 대기 건수. 요청은 `redirectOnUnauthorized: false` 로 보내 인증 만료를 ApiError(401)로 던진다 —
   * 사이드바가 그 신호로 로그인 상태를 다시 맞춘다(삼키면 만료 탭이 폴링을 멈추지 않는다).
   */
  countPending(): Promise<number>;
}

/** 설정(/settings) 탭 — Base 탭은 10 단위 순서 */
export interface SettingsTabExtension {
  id: string;
  order: number;
  /** next-intl 전체 키 */
  labelKey: string;
  Icon: ComponentType<{ className?: string }>;
  Component: ComponentType;
  /** 탭이 행 단위로 즉시 저장한다 — 공용 저장 버튼·불러오기 실패 안내를 숨긴다 */
  ownsSaving?: boolean;
}

/** 관리자 대시보드(/admin) 바로가기 — Base 링크는 10 단위 순서 */
export interface AdminQuickLinkExtension {
  href: string;
  order: number;
  /** next-intl 전체 키 */
  titleKey: string;
  descKey: string;
  Icon: ComponentType<{ className?: string }>;
}

/** 입력창 `/` 메뉴의 표시 컴포넌트 입력 — 항목 모양은 add-on 이 정한다 */
export interface SlashMenuViewProps {
  items: readonly unknown[];
  /** 검색어가 비어 묶어 보이는 중 */
  grouped: boolean;
  /** 키보드 활성 인덱스 — items.length 는 "전체 보기" */
  activeIndex: number;
  loading: boolean;
  onSelect: (item: unknown) => void;
  onHover: (index: number) => void;
  onViewAll: () => void;
}

/**
 * 입력창 `/` 메뉴 — `/토큰` 감지·디바운스·키보드 이동·닫기는 Base 입력창이 하고, 후보 조회·정렬·삽입 텍스트·전체 보기 주소·
 * 표시는 add-on 이 준다. 켜진 add-on 이 없으면 메뉴가 뜨지 않는다(입력한 `/텍스트` 는 그대로 보낸다).
 */
export interface SlashMenuExtension {
  /** react-query 키 접두 */
  queryKey: string;
  fetch(query: string): Promise<unknown[]>;
  /** 검색어가 비었을 때의 정렬(묶음 헤더용) — 없으면 그대로 */
  arrangeGrouped?(items: readonly unknown[]): unknown[];
  /** 선택 시 입력창에 채울 텍스트 */
  insertText(item: unknown): string;
  viewAllHref: string;
  View: ComponentType<SlashMenuViewProps>;
}

/** 허브 탭 바(components/hub-tabs.tsx) — 허브 이름은 Base 가 정한다 */
export type HubId = "history" | "agents" | "developer" | "admin";

/** 허브 탭 바에 add-on 화면(보통 `pages.ts` 에 등록한 URL)을 끼운다. 꺼진 add-on 의 탭은 보이지 않는다 */
export interface HubTabExtension {
  hub: HubId;
  href: string;
  /** next-intl 전체 키(예: "pageTabs.research") */
  labelKey: string;
  /** Base 탭은 10 단위(10·20·30…) — 그 사이 값으로 위치를 정한다 */
  order: number;
}

/** add-on 화면 렌더 입력 — 경로는 `path` 뒤의 조각만, 쿼리는 Next 의 searchParams 그대로 */
export interface WebAddonPageProps {
  segments: readonly string[];
  searchParams: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * add-on 이 소유한 화면 — URL 첫 조각(`/knowledge/...` 의 `knowledge`)으로 찾는다. Base 의 catch-all 라우트가
 * 서버에서 `addons/pages.ts` 만 보고 렌더하므로, 이 계약은 서버에서 import 해도 안전해야 한다(훅 없음, 화면 컴포넌트는 "use client").
 */
export interface WebAddonPage {
  path: string;
  /** 놓이는 영역 — admin 이면 `/admin/<path>` 이고 관리자 가드(`AdminGuard`)가 감싼다. 기본 workspace */
  area?: "workspace" | "admin";
  /** 이 add-on 이 다루지 않는 하위 경로면 null — Base 가 404 로 응답한다 */
  render(props: WebAddonPageProps): ReactNode | null;
}
