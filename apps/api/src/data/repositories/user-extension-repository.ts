/**
 * user_extensions 저장소 — 확장 번들 설치 레코드 (Phase 1).
 *
 * 구성요소(agent_skills/mcp_servers)는 extension_id 로 링크되고 자체 draft→approve
 * 라이프사이클을 유지한다. 이 저장소는 번들 단위 목록/제거만 담당.
 *
 * 보안 보장:
 *   - remove 는 소유자(또는 admin) 한정 + 링크된 구성요소를 archive (mcp 는 enabled=false 동반)
 *   - insert 는 항상 status='active' (구성요소 승인 여부와 무관한 설치 레코드)
 *
 * @module data/repositories/user-extension-repository
 */
import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './base-repository';

export interface UserExtensionRow {
    id: string;
    user_id: string;
    name: string;
    version: string;
    description: string | null;
    source_url: string;
    source_ref: string;
    source_path: string;
    source_hash: string;
    manifest: Record<string, unknown>;
    status: 'active' | 'removed';
    created_at: Date;
    updated_at: Date;
}

export interface InsertExtensionInput {
    userId: string;
    name: string;
    version: string;
    description?: string | null;
    sourceUrl: string;
    sourceRef: string;
    sourcePath: string;
    sourceHash: string;
    manifest: Record<string, unknown>;
}

export class UserExtensionRepository extends BaseRepository {
    async insert(input: InsertExtensionInput): Promise<UserExtensionRow> {
        const id = `user-ext-${uuidv4()}`;
        const r = await this.query<UserExtensionRow>(
            `INSERT INTO user_extensions
               (id, user_id, name, version, description, source_url, source_ref, source_path, source_hash, manifest, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, 'active')
             RETURNING *`,
            [
                id,
                input.userId,
                input.name,
                input.version,
                input.description ?? null,
                input.sourceUrl,
                input.sourceRef,
                input.sourcePath,
                input.sourceHash,
                JSON.stringify(input.manifest),
            ]
        );
        return r.rows[0];
    }

    async getByIdForUser(id: string, userId: string, isAdmin: boolean): Promise<UserExtensionRow | null> {
        const r = await this.query<UserExtensionRow>(
            isAdmin
                ? `SELECT * FROM user_extensions WHERE id=$1 LIMIT 1`
                : `SELECT * FROM user_extensions WHERE id=$1 AND user_id=$2 LIMIT 1`,
            isAdmin ? [id] : [id, userId]
        );
        return r.rows[0] ?? null;
    }

    async listActiveForUser(userId: string, limit: number = 50): Promise<UserExtensionRow[]> {
        const r = await this.query<UserExtensionRow>(
            `SELECT * FROM user_extensions
              WHERE user_id=$1 AND status='active'
              ORDER BY created_at DESC
              LIMIT $2`,
            [userId, limit]
        );
        return r.rows;
    }

    async countActiveForUser(userId: string): Promise<number> {
        const r = await this.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM user_extensions
              WHERE user_id=$1 AND status='active'`,
            [userId]
        );
        return parseInt(r.rows[0].count, 10);
    }

    /** windowHours 내 동일 source_hash 의 active 설치가 있으면 반환 (dedupe). */
    async findRecentByHash(
        userId: string,
        sourceHash: string,
        windowHours: number,
    ): Promise<UserExtensionRow | null> {
        const r = await this.query<UserExtensionRow>(
            `SELECT * FROM user_extensions
              WHERE user_id=$1 AND status='active' AND source_hash=$2
                AND created_at > NOW() - ($3 || ' hours')::INTERVAL
              ORDER BY created_at DESC
              LIMIT 1`,
            [userId, sourceHash, windowHours.toString()]
        );
        return r.rows[0] ?? null;
    }

    /** 같은 이름의 active 설치 존재 여부 (partial unique 위반 사전 감지). */
    async findActiveByName(userId: string, name: string): Promise<UserExtensionRow | null> {
        const r = await this.query<UserExtensionRow>(
            `SELECT * FROM user_extensions
              WHERE user_id=$1 AND name=$2 AND status='active'
              LIMIT 1`,
            [userId, name]
        );
        return r.rows[0] ?? null;
    }

    /** ingest 로 생성된 구성요소를 확장에 링크. (구성요소 상한이 작아 개별 UPDATE — QueryParam 배열 미지원) */
    async linkComponents(extensionId: string, skillIds: string[], mcpServerIds: string[]): Promise<void> {
        for (const skillId of skillIds) {
            await this.query(
                `UPDATE agent_skills SET extension_id=$1 WHERE id=$2`,
                [extensionId, skillId]
            );
        }
        for (const serverId of mcpServerIds) {
            await this.query(
                `UPDATE mcp_servers SET extension_id=$1, updated_at=NOW() WHERE id=$2`,
                [extensionId, serverId]
            );
        }
    }

    /** 링크된 구성요소의 현재 상태 (상세 조회용). */
    async listComponents(extensionId: string): Promise<{
        skills: Array<{ id: string; name: string; status: string }>;
        mcpServers: Array<{ id: string; name: string; status: string; enabled: boolean }>;
    }> {
        const skills = await this.query<{ id: string; name: string; status: string }>(
            `SELECT id, name, status FROM agent_skills WHERE extension_id=$1 ORDER BY name`,
            [extensionId]
        );
        const servers = await this.query<{ id: string; name: string; status: string; enabled: boolean }>(
            `SELECT id, name, status, enabled FROM mcp_servers WHERE extension_id=$1 ORDER BY name`,
            [extensionId]
        );
        return { skills: skills.rows, mcpServers: servers.rows };
    }

    /**
     * 번들 제거 — 링크 구성요소 archive + 설치 레코드 soft remove.
     * 소유자(또는 admin) 한정. 반환: 제거된 row 또는 null (권한/상태 불일치).
     */
    async remove(id: string, userId: string, isAdmin: boolean): Promise<UserExtensionRow | null> {
        const existing = await this.getByIdForUser(id, userId, isAdmin);
        if (!existing || existing.status !== 'active') return null;

        await this.query(
            `UPDATE agent_skills SET status='archived' WHERE extension_id=$1`,
            [id]
        );
        await this.query(
            `UPDATE mcp_servers SET status='archived', enabled=FALSE, updated_at=NOW() WHERE extension_id=$1`,
            [id]
        );
        const r = await this.query<UserExtensionRow>(
            `UPDATE user_extensions SET status='removed', updated_at=NOW()
              WHERE id=$1 AND status='active'
              RETURNING *`,
            [id]
        );
        return r.rows[0] ?? null;
    }
}
