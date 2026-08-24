/**
 * draft 목록 쿼리 빌더 — SkillRepository 에서 분리 (파일 크기 가드).
 *
 * SQL 조립만 담당하는 순수 함수라 DB 없이 단위 테스트할 수 있다.
 *
 * @module data/repositories/skill-draft-query
 */
import type { QueryParam } from './base-repository';

export interface DraftQueryOptions {
    target?: 'user' | 'system' | 'all';
    userId?: string;
    limit?: number;
    offset?: number;
}

export interface DraftQuery {
    /** 총 개수 SQL (WHERE 만, JOIN 없음) */
    countSql: string;
    /** 목록 SQL (확장 LEFT JOIN 포함) */
    dataSql: string;
    /** countSql 용 파라미터 */
    params: QueryParam[];
    /** dataSql 용 파라미터 (params + limit + offset) */
    dataParams: QueryParam[];
    limit: number;
    offset: number;
}

/** 한 번에 가져올 수 있는 최대 개수 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * draft 목록 SQL 조립.
 *
 * 목록 쿼리는 `user_extensions` 를 LEFT JOIN 해 **확장 이름을 함께 싣는다** — draft
 * 화면이 확장별로 묶어 일괄 승인/거부할 수 있게 하기 위함이다. LEFT 라 확장 유래가
 * 아닌 draft 도 그대로 나온다.
 */
export function buildDraftQuery(options: DraftQueryOptions): DraftQuery {
    const conditions: string[] = [`status = 'draft'`];
    const params: QueryParam[] = [];
    let paramIdx = 1;

    const target = options.target ?? 'user';
    if (target === 'user') {
        if (!options.userId) {
            throw new Error('listDrafts: target=user 는 userId 필수');
        }
        conditions.push(`created_by = $${paramIdx}`);
        params.push(options.userId);
        paramIdx += 1;
    } else if (target === 'system') {
        conditions.push(`created_by IS NULL`);
    }
    // target === 'all' → 추가 조건 없음

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(0, options.offset ?? 0);

    // JOIN 쿼리에서는 컬럼이 모호해지므로 별칭을 붙인다
    const scopedWhere = whereClause.replace(/\b(status|created_by)\b/g, 's.$1');

    return {
        countSql: `SELECT COUNT(*) AS total FROM agent_skills ${whereClause}`,
        dataSql: `SELECT s.id, s.name, s.description, s.content, s.category, s.is_public, s.created_by,
                    s.created_at, s.updated_at, s.source_repo, s.source_path, s.status, s.manifest_meta,
                    s.extension_id, e.name AS extension_name
             FROM agent_skills s
             LEFT JOIN user_extensions e ON e.id = s.extension_id
             ${scopedWhere}
             ORDER BY s.created_at DESC, s.id ASC
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        params,
        dataParams: [...params, limit, offset],
        limit,
        offset,
    };
}
