/**
 * 스킬 사용 기록 — `skill_audit_log` 에 사용 이벤트를 남긴다 (2026-08-29).
 *
 * 배경: 021 마이그레이션이 만든 `skill_audit_log` 는 "스킬 하에서의 도구 호출 감사" 용도로
 * 설계됐지만 쓰는 코드가 한 곳도 없어 운영에서 0행이었다. 그 탓에 "사용하지 않는 스킬"
 * 판정을 대화 메시지 간접 집계로 해야 했다. 이 모듈이 4개 채널의 사용 이벤트를 같은
 * 테이블에 기록한다 — `tool_called` 컬럼을 이벤트 종류로 쓴다:
 *   - `slash`      사용자가 `/slug` 로 스킬을 명시 호출 (chat/slash-command)
 *   - `load_skill` 모델이 load_skill 도구로 스킬 본문을 불러옴 (mcp/load-skill-tool)
 *   - `inject`     시스템 프롬프트에 자동 주입됨 (skill-manager.buildManifestPrompt — 에이전트/전역/개인 배정)
 *   - `skill_run`  절차 스킬 재생 (agent-task/procedural-skill)
 *
 * 원칙: **fail-open·fire-and-forget** — 기록 실패가 채팅/도구를 절대 죽이지 않는다.
 * 턴당 여러 스킬이 주입되므로 한 번의 INSERT ... SELECT unnest 로 배치 삽입한다.
 * 스키마 제약(NOT NULL): user_id 는 비로그인 시 'guest', skill_version 은 모르면 'legacy',
 * args_hash 는 sha256(args JSON) — 원문 인자는 저장하지 않는다(민감정보).
 *
 * @module agents/skill-usage-log
 */
import * as crypto from 'crypto';
import { createLogger } from '../utils/logger';
import { SKILL_USAGE_LOG } from '../config/constants';

const logger = createLogger('SkillUsageLog');

export type SkillUsageKind = 'slash' | 'load_skill' | 'inject' | 'skill_run';
export type SkillUsageStatus = 'ok' | 'error' | 'denied';

export interface SkillUsageEvent {
    skillId: string;
    kind: SkillUsageKind;
    userId?: string | null;
    /** skill_manifests.version — 모르면 'legacy' */
    skillVersion?: string | null;
    /** 해시만 저장 (원문 미보관) */
    args?: unknown;
    status?: SkillUsageStatus;
    durationMs?: number | null;
}

export const GUEST_USER_ID = 'guest';
export const UNKNOWN_SKILL_VERSION = 'legacy';

export function hashArgs(args: unknown): string {
    const text = args === undefined ? '' : typeof args === 'string' ? args : JSON.stringify(args);
    return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * 사용 이벤트를 비동기로 기록한다. await 하지 않아도 되며 절대 throw 하지 않는다.
 * 테스트·비DB 환경에선 조용히 no-op (DB 미초기화 → debug 로그).
 */
export function recordSkillUsage(events: SkillUsageEvent[]): void {
    if (!SKILL_USAGE_LOG.enabled) return;
    const rows = events.filter(e => typeof e.skillId === 'string' && e.skillId.length > 0);
    if (rows.length === 0) return;
    void insertRows(rows).catch(e => {
        logger.debug(`skill_audit_log 기록 실패 (무시): ${e instanceof Error ? e.message : String(e)}`);
    });
}

async function insertRows(rows: SkillUsageEvent[]): Promise<void> {
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const pool = getUnifiedDatabase().getPool();
    await pool.query(
        `INSERT INTO skill_audit_log (user_id, skill_id, skill_version, tool_called, args_hash, result_status, duration_ms)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[])`,
        [
            rows.map(r => r.userId ? String(r.userId) : GUEST_USER_ID),
            rows.map(r => r.skillId),
            rows.map(r => r.skillVersion || UNKNOWN_SKILL_VERSION),
            rows.map(r => r.kind),
            rows.map(r => hashArgs(r.args)),
            rows.map(r => r.status ?? 'ok'),
            rows.map(r => (typeof r.durationMs === 'number' ? Math.round(r.durationMs) : null)),
        ],
    );
}

export interface SkillUsageSummaryRow {
    skillId: string;
    name: string | null;
    status: string | null;
    createdBy: string | null;
    total: number;
    byKind: Record<string, number>;
    lastUsedAt: string | null;
}

/**
 * 스킬별 사용 요약 — 최근 `days` 일. ownerUserId 를 주면 그 사용자가 만든 스킬(+시스템 스킬)만.
 * 삭제된 스킬의 이벤트도 남아 있으므로 name/status 는 null 일 수 있다.
 */
export async function getSkillUsageSummary(opts: { days: number; ownerUserId?: string }): Promise<SkillUsageSummaryRow[]> {
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const pool = getUnifiedDatabase().getPool();
    const params: unknown[] = [opts.days];
    const ownerClause = opts.ownerUserId ? ` AND (s.created_by = $2 OR s.created_by IS NULL)` : '';
    if (opts.ownerUserId) params.push(opts.ownerUserId);
    const r = await pool.query<{
        skill_id: string; name: string | null; status: string | null; created_by: string | null;
        total: string; by_kind: Record<string, number>; last_used_at: Date | null;
    }>(
        `SELECT a.skill_id, s.name, s.status, s.created_by,
                count(*)::text AS total,
                jsonb_object_agg(a.tool_called, a.n) AS by_kind,
                max(a.last_ts) AS last_used_at
           FROM (
                SELECT skill_id, tool_called, count(*)::int AS n, max(ts) AS last_ts
                  FROM skill_audit_log
                 WHERE ts >= NOW() - ($1::int * INTERVAL '1 day')
                 GROUP BY skill_id, tool_called
           ) a
           LEFT JOIN agent_skills s ON s.id = a.skill_id
          WHERE TRUE${ownerClause}
          GROUP BY a.skill_id, s.name, s.status, s.created_by
          ORDER BY max(a.last_ts) DESC`,
        params,
    );
    return r.rows.map(row => ({
        skillId: row.skill_id,
        name: row.name,
        status: row.status,
        createdBy: row.created_by,
        total: parseInt(row.total, 10),
        byKind: row.by_kind ?? {},
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    }));
}
