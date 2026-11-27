/**
 * MCP 협상 관측 저장소(MCP-1) — 표 `mcp_negotiation_observations`(팩 마이그레이션 addon:mcp-runtime:001).
 *
 * 쓰기는 서버당 1행 upsert(마지막 연결 기준, 횟수 누적). DB 에 없는 서버(설정 파일에서만 온 서버 등)는
 * 조용히 건너뛴다 — FK 위반으로 로그를 어지럽히지 않게 `WHERE EXISTS` 로 거른다.
 * 읽기(list)는 관리자 현황(M3)·호환 판정(M1)용 — 소유자 정보는 mcp_servers 에서 붙인다.
 *
 * @module addons/mcp-runtime/data/mcp-negotiation-repository
 */
import type { Pool } from 'pg';
import type { McpExtensionRef, McpNegotiationObservation, NegotiationSink } from '../negotiation-observer';
import type { DeclaredExtensionSource } from '../extension-awareness';

export interface McpNegotiationRecord extends McpNegotiationObservation {
    /** 서버 설정 이름(mcp_servers.name) — 서버가 스스로 밝힌 serverName 과 별개 */
    configuredName: string;
    /** 소유자 — NULL 이면 전역 서버 */
    userId: string | null;
    catalogTemplateId: string | null;
    firstObservedAt: string;
    observedAt: string;
    observationCount: number;
}

export interface McpNegotiationListFilter {
    transport?: string;
    protocolEra?: string;
    limit?: number;
}

/** 목록 상한 — 라우트가 받는 limit 의 최대값 */
export const NEGOTIATION_LIST_LIMIT_MAX = 500;
const NEGOTIATION_LIST_LIMIT_DEFAULT = 200;

interface Row {
    server_id: string;
    transport: string;
    auth_method: string;
    protocol_era: string | null;
    protocol_version: string | null;
    sdk_generation: string;
    capabilities: string[] | null;
    extensions: McpExtensionRef[] | null;
    server_name: string | null;
    server_version: string | null;
    first_observed_at: Date | string;
    observed_at: Date | string;
    observation_count: number;
    configured_name: string;
    user_id: string | null;
    catalog_template_id: string | null;
}

function iso(v: Date | string): string {
    return v instanceof Date ? v.toISOString() : String(v);
}

export class McpNegotiationRepository implements NegotiationSink, DeclaredExtensionSource {
    constructor(private readonly pool: Pool) {}

    async upsert(o: McpNegotiationObservation): Promise<void> {
        await this.pool.query(
            `INSERT INTO mcp_negotiation_observations
                (server_id, transport, auth_method, protocol_era, protocol_version, sdk_generation,
                 capabilities, extensions, server_name, server_version)
             SELECT $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10
             WHERE EXISTS (SELECT 1 FROM mcp_servers WHERE id = $1)
             ON CONFLICT (server_id) DO UPDATE SET
                transport = EXCLUDED.transport,
                auth_method = EXCLUDED.auth_method,
                protocol_era = EXCLUDED.protocol_era,
                protocol_version = EXCLUDED.protocol_version,
                sdk_generation = EXCLUDED.sdk_generation,
                capabilities = EXCLUDED.capabilities,
                extensions = EXCLUDED.extensions,
                server_name = EXCLUDED.server_name,
                server_version = EXCLUDED.server_version,
                observed_at = NOW(),
                observation_count = mcp_negotiation_observations.observation_count + 1`,
            [
                o.serverId, o.transport, o.authMethod, o.protocolEra, o.protocolVersion, o.sdkGeneration,
                JSON.stringify(o.capabilities), JSON.stringify(o.extensions), o.serverName, o.serverVersion,
            ],
        );
    }

    async list(filter: McpNegotiationListFilter = {}): Promise<McpNegotiationRecord[]> {
        const limit = Math.min(Math.max(filter.limit ?? NEGOTIATION_LIST_LIMIT_DEFAULT, 1), NEGOTIATION_LIST_LIMIT_MAX);
        const r = await this.pool.query<Row>(
            `SELECT o.*, s.name AS configured_name, s.user_id, s.catalog_template_id
               FROM mcp_negotiation_observations o
               JOIN mcp_servers s ON s.id = o.server_id
              WHERE ($1::text IS NULL OR o.transport = $1)
                AND ($2::text IS NULL OR o.protocol_era = $2)
              ORDER BY o.observed_at DESC
              LIMIT $3`,
            [filter.transport ?? null, filter.protocolEra ?? null, limit],
        );
        return r.rows.map(row => ({
            serverId: row.server_id,
            transport: row.transport as McpNegotiationRecord['transport'],
            authMethod: row.auth_method as McpNegotiationRecord['authMethod'],
            protocolEra: row.protocol_era as McpNegotiationRecord['protocolEra'],
            protocolVersion: row.protocol_version,
            sdkGeneration: row.sdk_generation as McpNegotiationRecord['sdkGeneration'],
            capabilities: row.capabilities ?? [],
            extensions: row.extensions ?? [],
            serverName: row.server_name,
            serverVersion: row.server_version,
            configuredName: row.configured_name,
            userId: row.user_id,
            catalogTemplateId: row.catalog_template_id,
            firstObservedAt: iso(row.first_observed_at),
            observedAt: iso(row.observed_at),
            observationCount: row.observation_count,
        }));
    }
    /** 서버별 관측 요약(M1 판정용 구성요소 관측 포트) — 관측이 없는 서버는 맵에 없다. 주소·명령은 읽지 않는다 */
    async summariesByServerIds(serverIds: readonly string[]): Promise<Map<string, Pick<McpNegotiationObservation,
        'serverId' | 'transport' | 'authMethod' | 'protocolEra' | 'protocolVersion' | 'extensions'>>> {
        const out = new Map<string, Pick<McpNegotiationObservation,
            'serverId' | 'transport' | 'authMethod' | 'protocolEra' | 'protocolVersion' | 'extensions'>>();
        if (serverIds.length === 0) return out;
        const r = await this.pool.query<Pick<Row, 'server_id' | 'transport' | 'auth_method' | 'protocol_era' | 'protocol_version' | 'extensions'>>(
            `SELECT server_id, transport, auth_method, protocol_era, protocol_version, extensions
               FROM mcp_negotiation_observations WHERE server_id = ANY($1::text[])`,
            [[...serverIds]],
        );
        for (const row of r.rows) {
            out.set(row.server_id, {
                serverId: row.server_id,
                transport: row.transport as McpNegotiationObservation['transport'],
                authMethod: row.auth_method as McpNegotiationObservation['authMethod'],
                protocolEra: row.protocol_era as McpNegotiationObservation['protocolEra'],
                protocolVersion: row.protocol_version,
                extensions: row.extensions ?? [],
            });
        }
        return out;
    }

    /** 서버별 선언 확장(MCP-5) — 관측이 없는 서버는 맵에 없다 */
    async extensionsByServerIds(serverIds: readonly string[]): Promise<Map<string, McpExtensionRef[]>> {
        const out = new Map<string, McpExtensionRef[]>();
        if (serverIds.length === 0) return out;
        const r = await this.pool.query<{ server_id: string; extensions: McpExtensionRef[] | null }>(
            `SELECT server_id, extensions FROM mcp_negotiation_observations
              WHERE server_id = ANY($1::text[]) AND jsonb_array_length(extensions) > 0`,
            [[...serverIds]],
        );
        for (const row of r.rows) out.set(row.server_id, row.extensions ?? []);
        return out;
    }

    /** 카탈로그 템플릿별 선언 확장(MCP-5) — 그 템플릿으로 설치된 서버들의 관측 합집합(id 기준, 최근 관측 우선) */
    async extensionsByCatalogTemplateIds(templateIds: readonly string[]): Promise<Map<string, McpExtensionRef[]>> {
        const out = new Map<string, McpExtensionRef[]>();
        if (templateIds.length === 0) return out;
        const r = await this.pool.query<{ catalog_template_id: string; extensions: McpExtensionRef[] | null }>(
            `SELECT s.catalog_template_id, o.extensions
               FROM mcp_negotiation_observations o
               JOIN mcp_servers s ON s.id = o.server_id
              WHERE s.catalog_template_id = ANY($1::text[]) AND jsonb_array_length(o.extensions) > 0
              ORDER BY o.observed_at DESC`,
            [[...templateIds]],
        );
        for (const row of r.rows) {
            const merged = out.get(row.catalog_template_id) ?? [];
            for (const ext of row.extensions ?? []) {
                if (ext && typeof ext.id === 'string' && !merged.some(m => m.id === ext.id)) merged.push(ext);
            }
            out.set(row.catalog_template_id, merged);
        }
        return out;
    }
}
