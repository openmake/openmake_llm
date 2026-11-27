/**
 * MCP 확장 인식 (MCP-5, 마켓플레이스 계획 v3.7 §2-1) — 서버가 선언한 확장을 **분류해 보여 주기만** 한다.
 *
 * 2026-07-28 사양은 확장(extensions)을 코어와 따로 협상한다(SEP-2133, 역DNS id). OpenMake 는 어떤 확장도
 * 실행하지 않는다 — MCP Apps(UI)·Tasks·Skills over MCP 등을 선언한 서버가 있으면 "인식했으나 미지원" 으로
 * 정확히 알릴 뿐이다. 선언 원천은 MCP-1 협상 관측(`mcp_negotiation_observations.extensions`)이다 —
 * 관측 플래그가 꺼져 있었으면 기록이 없어 아무것도 붙지 않는다.
 *
 * 플래그 `MCP_EXTENSION_AWARENESS`(기본 OFF, system_settings 실시간) — 꺼져 있거나 서버가 확장을 선언하지
 * 않았으면 응답에 필드가 없다(응답 모양 종전 그대로). 연결·협상 경로는 건드리지 않는다.
 *
 * 분류 함수({@link classifyDeclaredExtensions})는 순수 함수다 — 갤러리 호환 판정(M1)이 그대로 쓴다.
 *
 * @module addons/mcp-runtime/extension-awareness
 */
import { readSettingValue } from '../../config/env';
import type { McpExtensionRef } from './negotiation-observer';

export const MCP_EXTENSION_AWARENESS_FLAG = 'MCP_EXTENSION_AWARENESS';

/** 확장 종류 — 표에 없는 id 는 `unknown` */
export type McpExtensionKind = 'apps' | 'tasks' | 'skills' | 'auth' | 'events' | 'unknown';

/**
 * 지원 상태 — OpenMake 는 지금 어떤 확장도 실행하지 않는다.
 *   - `unsupported`: 인식했으나 실행하지 않는다(서버의 기본 도구는 그대로 쓸 수 있다)
 *   - `unrecognized`: 표에 없는 확장
 */
export type McpExtensionSupport = 'unsupported' | 'unrecognized';

export interface DeclaredExtension {
    id: string;
    version?: string;
    kind: McpExtensionKind;
    support: McpExtensionSupport;
}

/**
 * 공식 확장 id 표(2026-11-27 확인) — 새 확장은 여기에 한 줄(코드 분기 없음).
 * 출처: `@modelcontextprotocol/core` 2.4 `SKILLS_EXTENSION_ID`, modelcontextprotocol.io/extensions
 * (overview·client-matrix·tasks).
 */
export const KNOWN_MCP_EXTENSIONS: Readonly<Record<string, Exclude<McpExtensionKind, 'unknown'>>> = {
    'io.modelcontextprotocol/ui': 'apps',
    'io.modelcontextprotocol/tasks': 'tasks',
    'io.modelcontextprotocol/skills': 'skills',
    'io.modelcontextprotocol/oauth-client-credentials': 'auth',
    'io.modelcontextprotocol/enterprise-managed-authorization': 'auth',
    'io.modelcontextprotocol/events': 'events',
};

/** 선언 목록 → 분류. 입력 순서와 무관하게 id 순, 같은 id 는 하나. 순수 함수 */
export function classifyDeclaredExtensions(refs: readonly McpExtensionRef[] | null | undefined): DeclaredExtension[] {
    if (!Array.isArray(refs)) return [];
    const out = new Map<string, DeclaredExtension>();
    for (const ref of refs) {
        if (!ref || typeof ref.id !== 'string' || !ref.id || out.has(ref.id)) continue;
        const known: McpExtensionKind | undefined = Object.prototype.hasOwnProperty.call(KNOWN_MCP_EXTENSIONS, ref.id)
            ? KNOWN_MCP_EXTENSIONS[ref.id] : undefined;
        const kind: McpExtensionKind = known ?? 'unknown';
        out.set(ref.id, {
            id: ref.id,
            ...(typeof ref.version === 'string' && ref.version ? { version: ref.version } : {}),
            kind,
            support: kind === 'unknown' ? 'unrecognized' : 'unsupported',
        });
    }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Skills over MCP 를 선언했는가 — 판정(M1)에서 "스킬 제공 서버" 로 보인다 */
export function providesSkills(declared: readonly DeclaredExtension[]): boolean {
    return declared.some(d => d.kind === 'skills');
}

export function extensionAwarenessEnabled(): boolean {
    try {
        return readSettingValue(MCP_EXTENSION_AWARENESS_FLAG) === 'true';
    } catch {
        return false;
    }
}

/** 응답 필드 — 비어 있으면 빈 객체(미선언 서버는 응답 모양 불변) */
export function declaredExtensionFields(refs: readonly McpExtensionRef[] | null | undefined): { declaredExtensions?: DeclaredExtension[] } {
    const declared = classifyDeclaredExtensions(refs);
    return declared.length ? { declaredExtensions: declared } : {};
}

/** 관측 원천 — 저장소가 구현한다(라우트 테스트가 가짜로 바꿔 끼운다) */
export interface DeclaredExtensionSource {
    extensionsByServerIds(serverIds: readonly string[]): Promise<Map<string, McpExtensionRef[]>>;
    extensionsByCatalogTemplateIds(templateIds: readonly string[]): Promise<Map<string, McpExtensionRef[]>>;
}

type FieldLookup = (id: string) => { declaredExtensions?: DeclaredExtension[] };
const NONE: FieldLookup = () => ({});

async function lookup(
    ids: readonly string[],
    load: (ids: readonly string[]) => Promise<Map<string, McpExtensionRef[]>>,
): Promise<FieldLookup> {
    if (!extensionAwarenessEnabled() || ids.length === 0) return NONE;
    try {
        const byId = await load(ids);
        return (id: string) => declaredExtensionFields(byId.get(id));
    } catch {
        return NONE; // 조회 실패는 표시만 빠진다(fail-open) — 목록 응답을 막지 않는다
    }
}

/** 서버 id 들 → 응답에 펼칠 필드를 돌려주는 함수. 플래그 OFF·조회 실패면 늘 빈 객체 */
export function serverExtensionLookup(source: DeclaredExtensionSource, serverIds: readonly string[]): Promise<FieldLookup> {
    return lookup(serverIds, ids => source.extensionsByServerIds(ids));
}

/** 카탈로그 템플릿 id 들 → 그 템플릿으로 설치된 서버들이 선언한 확장(합집합) */
export function catalogExtensionLookup(source: DeclaredExtensionSource, templateIds: readonly string[]): Promise<FieldLookup> {
    return lookup(templateIds, ids => source.extensionsByCatalogTemplateIds(ids));
}
