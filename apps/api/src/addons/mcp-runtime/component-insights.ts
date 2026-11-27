/**
 * MCP 서버 관측을 Base 의 구성요소 관측 포트로 내준다 (M1 갤러리 판정, 2026-11-27).
 *
 * 다른 add-on(갤러리 판정)은 이 add-on 을 import 하지 않고 `runtime-ports/component-insights` 만 안다.
 * 값은 협상 관측(MCP-1) 요약 + 선언 확장 분류(MCP-5) — 주소·명령·토큰은 싣지 않는다.
 *
 * @module addons/mcp-runtime/component-insights
 */
import type { McpServerInsight } from '../../runtime-ports/component-insights';
import { classifyDeclaredExtensions } from './extension-awareness';
import type { McpNegotiationObservation } from './negotiation-observer';

type Summary = Pick<McpNegotiationObservation, 'serverId' | 'transport' | 'authMethod' | 'protocolEra' | 'protocolVersion' | 'extensions'>;

export interface McpInsightSource {
    summariesByServerIds(serverIds: readonly string[]): Promise<ReadonlyMap<string, Summary>>;
}

/** PURE: 관측 요약 → 포트 값 */
export function toServerInsight(s: Summary): McpServerInsight {
    return {
        serverId: s.serverId,
        transport: s.transport,
        authMethod: s.authMethod,
        protocolEra: s.protocolEra,
        protocolVersion: s.protocolVersion,
        declaredExtensionKinds: [...new Set(classifyDeclaredExtensions(s.extensions).map(d => d.kind))],
    };
}

export function mcpServerInsightProvider(source: McpInsightSource) {
    return async (serverIds: readonly string[]): Promise<ReadonlyMap<string, McpServerInsight>> => {
        const rows = await source.summariesByServerIds(serverIds);
        return new Map([...rows.entries()].map(([id, s]) => [id, toServerInsight(s)]));
    };
}
