/**
 * 절차 스킬 휴면 판정 — 재생 기록(skill_audit_log 의 skill_run)으로 연속 실패·장기 미사용 스킬을 가려
 * 이름 매칭·재사용 제안 후보에서 뺀다. 상태를 저장하지 않고 조회 때 규칙으로 계산한다(삭제·상태 변경 없음).
 * 정확한 skill_id 재생은 막지 않으므로, 다시 성공하거나 고쳐 쓰면 후보로 돌아온다.
 *
 * @module services/agent-task/procedural-dormancy
 */
import { getPool } from '../../data/models/unified-database';
import { PROCEDURAL_DORMANCY } from '../../config/agent-task-skill-memory';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ProceduralDormancy');
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SkillRunRow {
    skillId: string;
    status: 'ok' | 'error' | 'denied';
    ts: Date;
}

interface DormancyRule {
    failStreak: number;
    staleDays: number;
}

const DEFAULT_RULE: DormancyRule = { failStreak: PROCEDURAL_DORMANCY.FAIL_STREAK, staleDays: PROCEDURAL_DORMANCY.STALE_DAYS };

/**
 * PURE: 휴면 여부. runs 는 최신순.
 *  - 마지막 갱신(updatedAt) 뒤의 재생이 failStreak 회 연속 실패
 *  - 갱신과 마지막 재생이 모두 staleDays 보다 오래됨
 */
export function isProceduralDormant(
    updatedAt: Date,
    runs: ReadonlyArray<Pick<SkillRunRow, 'status' | 'ts'>>,
    now: Date,
    rule: DormancyRule = DEFAULT_RULE,
): boolean {
    const since = runs.filter((r) => r.ts.getTime() > updatedAt.getTime());
    if (rule.failStreak > 0 && since.length >= rule.failStreak && since.slice(0, rule.failStreak).every((r) => r.status === 'error')) return true;
    const lastTouched = Math.max(updatedAt.getTime(), runs[0]?.ts.getTime() ?? 0);
    return rule.staleDays > 0 && now.getTime() - lastTouched > rule.staleDays * DAY_MS;
}

/** 스킬별 최근 재생 기록(최신순, 스킬당 failStreak 건까지). */
async function loadRecentRuns(skillIds: string[]): Promise<SkillRunRow[]> {
    const r = await getPool().query<{ skill_id: string; result_status: SkillRunRow['status']; ts: Date }>(
        `SELECT skill_id, result_status, ts FROM (
             SELECT skill_id, result_status, ts, row_number() OVER (PARTITION BY skill_id ORDER BY ts DESC) AS rn
               FROM skill_audit_log
              WHERE tool_called = 'skill_run' AND skill_id = ANY($1::text[])
         ) x WHERE rn <= $2 ORDER BY ts DESC`,
        [skillIds, Math.max(1, PROCEDURAL_DORMANCY.FAIL_STREAK)],
    );
    return r.rows.map((row) => ({ skillId: row.skill_id, status: row.result_status, ts: new Date(row.ts) }));
}

/** 휴면 스킬을 뺀 목록. 꺼져 있거나 기록 조회가 실패하면 그대로 돌려준다(작업을 막지 않는다). */
export async function dropDormantSkills<T extends { id: string; updatedAt: Date }>(
    skills: T[],
    load: (skillIds: string[]) => Promise<SkillRunRow[]> = loadRecentRuns,
    now: Date = new Date(),
): Promise<T[]> {
    if (!PROCEDURAL_DORMANCY.ENABLED || skills.length === 0) return skills;
    try {
        const rows = await load(skills.map((s) => s.id));
        const kept = skills.filter((s) => !isProceduralDormant(new Date(s.updatedAt), rows.filter((r) => r.skillId === s.id), now));
        if (kept.length < skills.length) logger.info(`[Procedural] 휴면 스킬 ${skills.length - kept.length}건을 후보에서 뺌`);
        return kept;
    } catch (e) {
        logger.debug(`[Procedural] 재생 기록 조회 실패 — 휴면 판정 건너뜀: ${e instanceof Error ? e.message : e}`);
        return skills;
    }
}
