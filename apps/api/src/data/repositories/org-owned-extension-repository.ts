/**
 * 조직 소유 확장 저장소(212, opt-in EXTENSION_ORG_OWNED_INSTALL_ENABLED) — user_extensions 의 `owner_org_id` 행만 다룬다.
 *
 * 조직 소유 행: user_id = NULL · owner_org_id = 조직 · visibility='organization' · org_id = owner_org_id(212 CHECK).
 * 이 저장소의 모든 쿼리는 `owner_org_id = $n` 으로 범위를 건다 — 사람 소유 행을 건드리지 않고, 사람 소유 경로
 * (`user_id = $n`)는 이 행에 닿지 않는다. 인가 판단은 하지 않는다 — 호출부(services/extensions/org-owned-install)가
 * security/authorize 로 판정한 조직 id 만 넘긴다.
 *
 * 조직 소유 행은 구성요소(스킬·MCP·에이전트)를 직접 갖지 않는다 — 조직의 갤러리 항목(원본·digest/커밋 고정)이고,
 * 멤버는 종전처럼 갤러리에서 자기 계정으로 설치한다(getInstallableById 와 같은 조건).
 *
 * @module data/repositories/org-owned-extension-repository
 */
import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from './base-repository';
import type { UserExtensionRow } from './user-extension-repository';

export interface OrgOwnedExtensionRow extends Omit<UserExtensionRow, 'user_id'> {
    user_id: null;
    owner_org_id: string;
    installed_by_user_id: string | null;
}

export interface OrgOwnedSourceInput {
    name: string;
    version: string;
    description?: string | null;
    sourceUrl: string;
    sourceRef: string;
    sourcePath: string;
    sourceHash: string;
    trackingRef?: string | null;
    manifest: Record<string, unknown>;
}

/** 같은 조직에 같은 이름의 active 조직 소유 행(212 부분 유니크 인덱스) */
export const ORG_OWNED_NAME_CONFLICT = 'ORG_OWNED_NAME_CONFLICT';

function isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string })?.code === '23505';
}

export class OrgOwnedExtensionRepository extends BaseRepository {
    async insert(orgId: string, installedBy: string, input: OrgOwnedSourceInput): Promise<OrgOwnedExtensionRow> {
        const id = `user-ext-${uuidv4()}`;
        try {
            const r = await this.query<OrgOwnedExtensionRow>(
                `INSERT INTO user_extensions
                   (id, user_id, owner_org_id, installed_by_user_id, visibility, org_id,
                    name, version, description, source_url, source_ref, source_path, source_hash, tracking_ref, manifest, status)
                 VALUES ($1, NULL, $2, $3, 'organization', $2, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'active')
                 RETURNING *`,
                [id, orgId, installedBy, input.name, input.version, input.description ?? null, input.sourceUrl,
                    input.sourceRef, input.sourcePath, input.sourceHash, input.trackingRef ?? null, JSON.stringify(input.manifest)],
            );
            return r.rows[0];
        } catch (err) {
            if (isUniqueViolation(err)) throw new Error(`${ORG_OWNED_NAME_CONFLICT}: ${input.name}`);
            throw err;
        }
    }

    async getById(id: string): Promise<OrgOwnedExtensionRow | null> {
        const r = await this.query<OrgOwnedExtensionRow>(
            `SELECT * FROM user_extensions WHERE id=$1 AND owner_org_id IS NOT NULL AND status='active' LIMIT 1`,
            [id],
        );
        return r.rows[0] ?? null;
    }

    async listForOrg(orgId: string, limit: number): Promise<OrgOwnedExtensionRow[]> {
        const r = await this.query<OrgOwnedExtensionRow>(
            `SELECT * FROM user_extensions WHERE owner_org_id=$1 AND status='active' ORDER BY updated_at DESC LIMIT $2`,
            [orgId, limit],
        );
        return r.rows;
    }

    /** 업데이트 — 원본을 다시 풀어 고정한 ref·버전·매니페스트로 갱신(같은 조직 범위) */
    async updateSource(id: string, orgId: string, input: OrgOwnedSourceInput): Promise<OrgOwnedExtensionRow | null> {
        const r = await this.query<OrgOwnedExtensionRow>(
            `UPDATE user_extensions
                SET version=$3, description=$4, source_url=$5, source_ref=$6, source_path=$7, source_hash=$8,
                    tracking_ref=$9, manifest=$10::jsonb, updated_at=NOW()
              WHERE id=$1 AND owner_org_id=$2 AND status='active'
              RETURNING *`,
            [id, orgId, input.version, input.description ?? null, input.sourceUrl, input.sourceRef, input.sourcePath,
                input.sourceHash, input.trackingRef ?? null, JSON.stringify(input.manifest)],
        );
        return r.rows[0] ?? null;
    }

    async remove(id: string, orgId: string): Promise<OrgOwnedExtensionRow | null> {
        const r = await this.query<OrgOwnedExtensionRow>(
            `UPDATE user_extensions SET status='removed', updated_at=NOW()
              WHERE id=$1 AND owner_org_id=$2 AND status='active'
              RETURNING *`,
            [id, orgId],
        );
        return r.rows[0] ?? null;
    }
}
