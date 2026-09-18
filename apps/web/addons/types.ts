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

export interface WebAddon {
  /** 서버 add-on id (`GET /api/addons`) */
  id: string;
  messageBlocks?: readonly MessageBlockExtension[];
  composerContext?: ComposerContextExtension;
  settingsGroups?: readonly SettingsGroupExtension[];
  apiKeyScopePresets?: readonly ApiKeyScopePresetExtension[];
}
