/**
 * Add-on 설치 이력 (마이그레이션 163) — 내장 add-on 이 싣는 항목을 "한 번만" 설치한다.
 *
 * 이력에 없는 항목만 넣는다 — 관리자가 지운 카탈로그 템플릿을 다음 부팅이 되살리지 않게 하기 위함이다.
 * 이미 있는 행(관리자 수정 포함)은 덮어쓰지 않는다(구 카탈로그 시드 마이그레이션과 같은 규칙).
 *
 * @module data/repositories/addon-install-repository
 */
import type { Pool } from 'pg';
import { getComponentStore } from '../../addon-host/addon-data';
import type { CatalogTemplateInstall } from '../../runtime-ports/component-stores';

// 템플릿 모양은 구성요소 저장 계약에 있다(카탈로그 테이블은 MCP add-on 소유)
export type { CatalogTemplateInstall } from '../../runtime-ports/component-stores';

export class AddonInstallRepository {
    constructor(private pool: Pool) {}

    /** @returns 이번에 새로 설치했으면 true, 이미 설치 이력이 있으면 false */
    async installCatalogTemplateOnce(addonId: string, template: CatalogTemplateInstall): Promise<boolean> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const claimed = await client.query(
                `INSERT INTO addon_installed_items (kind, item_id, addon_id) VALUES ('mcp-catalog', $1, $2)
                 ON CONFLICT (kind, item_id) DO NOTHING RETURNING item_id`,
                [template.id, addonId],
            );
            if ((claimed.rowCount ?? 0) === 0) {
                await client.query('ROLLBACK');
                return false;
            }
            // 카탈로그 테이블은 MCP add-on 소유 — 데이터 모듈의 저장 연산으로, 같은 트랜잭션 안에서(이력 claim 과 함께 커밋·롤백)
            await getComponentStore('mcpServers', client).installCatalogTemplate(template);
            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw err;
        } finally {
            client.release();
        }
    }
}
