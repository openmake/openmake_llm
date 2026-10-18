/**
 * 마켓플레이스 게시용 읽기 저장소 — 사용자가 **직접 만든** 구성요소만 내보낸다.
 *
 * 확장에서 설치된 것(extension_id IS NOT NULL)은 상류가 따로 있으니 재배포하지 않는다(라이선스·
 * 중복). MCP 는 env **키만** 읽는다 — 값(자격증명)은 어떤 경로로도 레포에 나가면 안 된다.
 *
 * @module data/repositories/marketplace-export-repository
 */
import type { Pool } from 'pg';
import { getComponentStore } from '../../addon-host/addon-data';
import type { ExportMcpServer, ExportSkill, ExportSkillAsset } from '../../runtime-ports/component-stores';

// 스킬·MCP 서버의 내보내기 모양은 구성요소 저장 계약에 있다(각 add-on 이 같은 모양으로 돌려준다)
export type { ExportSkill, ExportSkillAsset, ExportMcpServer } from '../../runtime-ports/component-stores';
export interface ExportAgent { id: string; name: string; description: string | null; system_prompt: string; model: string | null }

export class MarketplaceExportRepository {
    constructor(private readonly pool: Pool) {}

    /** 게시 후보 목록 (소유자 한정, 확장 유래 제외) */
    async listCandidates(userId: string): Promise<{ skills: Omit<ExportSkill, 'content' | 'manifest_meta'>[]; agents: Omit<ExportAgent, 'system_prompt'>[]; mcpServers: ExportMcpServer[] }> {
        // 스킬·MCP 서버는 각 add-on 소유 테이블 — 데이터 모듈의 저장 연산으로(같은 조건·같은 모양)
        const [skills, a, mcpServers] = await Promise.all([
            getComponentStore('skills', this.pool).listExportCandidates(userId),
            this.pool.query<Omit<ExportAgent, 'system_prompt'>>(
                `SELECT id, name, description, model FROM user_agents
                  WHERE user_id = $1 AND is_active = TRUE AND extension_id IS NULL ORDER BY updated_at DESC`, [userId]),
            getComponentStore('mcpServers', this.pool).listExportCandidates(userId),
        ]);
        return { skills, agents: a.rows, mcpServers };
    }

    /** listCandidates 의 fail-open 판 — 한 축의 조회 실패가 목록 전체를 죽이지 않게 */
    async getCandidatesSafe(userId: string): Promise<Awaited<ReturnType<MarketplaceExportRepository['listCandidates']>>> {
        try { return await this.listCandidates(userId); }
        catch { return { skills: [], agents: [], mcpServers: [] }; }
    }

    async getSkills(userId: string, ids: string[]): Promise<ExportSkill[]> {
        return getComponentStore('skills', this.pool).getForExport(userId, ids);
    }

    async getSkillAssets(skillIds: string[]): Promise<ExportSkillAsset[]> {
        return getComponentStore('skills', this.pool).getAssetsForExport(skillIds);
    }

    async getAgents(userId: string, ids: string[]): Promise<ExportAgent[]> {
        if (ids.length === 0) return [];
        const r = await this.pool.query<ExportAgent>(
            `SELECT id, name, description, system_prompt, model FROM user_agents
              WHERE user_id = $1 AND id = ANY($2::text[]) AND is_active = TRUE AND extension_id IS NULL`, [userId, ids]);
        return r.rows;
    }

    async getMcpServers(userId: string, ids: string[]): Promise<ExportMcpServer[]> {
        return getComponentStore('mcpServers', this.pool).getForExport(userId, ids);
    }
}
