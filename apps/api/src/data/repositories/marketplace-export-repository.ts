/**
 * 마켓플레이스 게시용 읽기 저장소 — 사용자가 **직접 만든** 구성요소만 내보낸다.
 *
 * 확장에서 설치된 것(extension_id IS NOT NULL)은 상류가 따로 있으니 재배포하지 않는다(라이선스·
 * 중복). MCP 는 env **키만** 읽는다 — 값(자격증명)은 어떤 경로로도 레포에 나가면 안 된다.
 *
 * @module data/repositories/marketplace-export-repository
 */
import type { Pool } from 'pg';

export interface ExportSkill {
    id: string;
    name: string;
    description: string | null;
    content: string;
    category: string | null;
    manifest_meta: Record<string, unknown> | null;
}
export interface ExportSkillAsset { skill_id: string; rel_path: string; content_type: string | null; content: Buffer }
export interface ExportAgent { id: string; name: string; description: string | null; system_prompt: string; model: string | null }
export interface ExportMcpServer {
    id: string;
    name: string;
    transport_type: 'stdio' | 'sse' | 'streamable-http';
    command: string | null;
    args: unknown[] | null;
    url: string | null;
    /** env 키 목록만 — 값은 절대 읽지 않는다 */
    env_keys: string[];
}

export class MarketplaceExportRepository {
    constructor(private readonly pool: Pool) {}

    /** 게시 후보 목록 (소유자 한정, 확장 유래 제외) */
    async listCandidates(userId: string): Promise<{ skills: Omit<ExportSkill, 'content' | 'manifest_meta'>[]; agents: Omit<ExportAgent, 'system_prompt'>[]; mcpServers: ExportMcpServer[] }> {
        const [s, a, m] = await Promise.all([
            this.pool.query<Omit<ExportSkill, 'content' | 'manifest_meta'>>(
                `SELECT id, name, description, category FROM agent_skills
                  WHERE created_by = $1 AND status = 'active' AND extension_id IS NULL ORDER BY updated_at DESC`, [userId]),
            this.pool.query<Omit<ExportAgent, 'system_prompt'>>(
                `SELECT id, name, description, model FROM user_agents
                  WHERE user_id = $1 AND is_active = TRUE AND extension_id IS NULL ORDER BY updated_at DESC`, [userId]),
            this.pool.query<ExportMcpServer>(
                `SELECT id, name, transport_type, command, args, url,
                        COALESCE((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(COALESCE(env, '{}'::jsonb)) k), '{}') AS env_keys
                   FROM mcp_servers
                  WHERE user_id = $1 AND status IS DISTINCT FROM 'draft' AND extension_id IS NULL ORDER BY name`, [userId]),
        ]);
        return { skills: s.rows, agents: a.rows, mcpServers: m.rows };
    }

    /** listCandidates 의 fail-open 판 — 한 축의 조회 실패가 목록 전체를 죽이지 않게 */
    async getCandidatesSafe(userId: string): Promise<Awaited<ReturnType<MarketplaceExportRepository['listCandidates']>>> {
        try { return await this.listCandidates(userId); }
        catch { return { skills: [], agents: [], mcpServers: [] }; }
    }

    async getSkills(userId: string, ids: string[]): Promise<ExportSkill[]> {
        if (ids.length === 0) return [];
        const r = await this.pool.query<ExportSkill>(
            `SELECT id, name, description, content, category, manifest_meta FROM agent_skills
              WHERE created_by = $1 AND id = ANY($2::text[]) AND status = 'active' AND extension_id IS NULL`, [userId, ids]);
        return r.rows;
    }

    async getSkillAssets(skillIds: string[]): Promise<ExportSkillAsset[]> {
        if (skillIds.length === 0) return [];
        const r = await this.pool.query<ExportSkillAsset>(
            `SELECT skill_id, rel_path, content_type, content FROM skill_assets WHERE skill_id = ANY($1::text[]) ORDER BY skill_id, rel_path`, [skillIds]);
        return r.rows;
    }

    async getAgents(userId: string, ids: string[]): Promise<ExportAgent[]> {
        if (ids.length === 0) return [];
        const r = await this.pool.query<ExportAgent>(
            `SELECT id, name, description, system_prompt, model FROM user_agents
              WHERE user_id = $1 AND id = ANY($2::text[]) AND is_active = TRUE AND extension_id IS NULL`, [userId, ids]);
        return r.rows;
    }

    async getMcpServers(userId: string, ids: string[]): Promise<ExportMcpServer[]> {
        if (ids.length === 0) return [];
        const r = await this.pool.query<ExportMcpServer>(
            `SELECT id, name, transport_type, command, args, url,
                    COALESCE((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(COALESCE(env, '{}'::jsonb)) k), '{}') AS env_keys
               FROM mcp_servers
              WHERE user_id = $1 AND id = ANY($2::text[]) AND status IS DISTINCT FROM 'draft' AND extension_id IS NULL`, [userId, ids]);
        return r.rows;
    }
}
