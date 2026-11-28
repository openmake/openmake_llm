/**
 * 확장 설치 이름·갤러리 묶음 플래그 (2026-11-28, opt-in — 둘 다 기본 OFF, system_settings 실시간).
 *
 * 배경: 큐레이션 카탈로그에 Claude Code 마켓플레이스(예: ruvnet/ruflo — 플러그인 49개 중 MCP 서버 정의는 3개)를
 * 등록하면 갤러리가 플러그인을 한 줄씩 49개로 펼쳤고, 설치한 MCP 서버 이름은 `<확장>-<서버 키>` 라
 * `ruflo-core-ruflo`·`ruflo-ai-team-ruflo-ai-team` 처럼 겹쳐 붙었다(도구 이름도 `ruflo-core-ruflo::memory_store`).
 *
 * - `EXTENSION_MCP_SERVER_KEY_NAMES` — 켜면 확장 번들의 MCP 서버를 **서버 키 그대로**(`ruflo`) 저장한다.
 *   Claude Code 가 같은 서버를 부르는 이름(`mcp__ruflo__…`)과 맞아 스킬 본문 참조가 그대로 이어진다.
 *   같은 사용자에게 그 이름이 이미 있으면 종전 이름(`<확장>-<키>`)으로, 그것도 있으면 종전처럼 난수 접미사.
 *   이미 설치된 행의 이름은 그대로다. 확장 **업데이트**는 MCP 서버를 회수하고 새로 만들어 재승인을 받으므로
 *   (extension-ingest-service), 켠 뒤의 첫 업데이트에서 새 이름으로 바뀐다 — 도구 이름(`<서버>::<도구>`)도 함께 바뀐다.
 * - `EXTENSION_GALLERY_GROUP_SOURCES` — 켜면 갤러리 응답에 `groupSources: true` 를 실어, 웹이 플러그인이
 *   여럿인 원본을 카드 하나(펼치기)로 묶는다. 꺼져 있으면 응답 모양이 종전과 같다.
 *
 * @module config/extension-naming
 */
import { readSettingValue } from './env';

export const EXTENSION_MCP_SERVER_KEY_NAMES_FLAG = 'EXTENSION_MCP_SERVER_KEY_NAMES';
export const EXTENSION_GALLERY_GROUP_SOURCES_FLAG = 'EXTENSION_GALLERY_GROUP_SOURCES';

export const EXTENSION_MCP_DEPENDENCY_HINTS_FLAG = 'EXTENSION_MCP_DEPENDENCY_HINTS';

/** 스킬이 부르는 MCP 서버가 사용자에게 없으면 설치 리포트에 제공 플러그인을 안내(agents/git-ingest/mcp-dependency-hint) */
export function extensionMcpDependencyHintsEnabled(): boolean {
    return readSettingValue(EXTENSION_MCP_DEPENDENCY_HINTS_FLAG) === 'true';
}

export function extensionMcpServerKeyNamesEnabled(): boolean {
    return readSettingValue(EXTENSION_MCP_SERVER_KEY_NAMES_FLAG) === 'true';
}

export function extensionGalleryGroupSourcesEnabled(): boolean {
    return readSettingValue(EXTENSION_GALLERY_GROUP_SOURCES_FLAG) === 'true';
}

/**
 * PURE: 확장 MCP 서버 이름 후보 — 앞에서부터 비어 있는 첫 이름을 쓴다(호출측이 중복을 확인).
 * 끄면 종전 그대로 `<확장>-<키>` 하나. 켜면 서버 키 → 종전 이름 순(같은 값이면 하나로).
 */
export function mcpServerNameCandidates(extensionName: string, serverKey: string, keyNames: boolean): string[] {
    const prefixed = `${extensionName}-${serverKey}`;
    if (!keyNames) return [prefixed];
    return serverKey === prefixed ? [serverKey] : [serverKey, prefixed];
}
