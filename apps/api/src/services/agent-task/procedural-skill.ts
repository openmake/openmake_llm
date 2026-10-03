/**
 * Procedural Skill (재생 가능 절차 스킬) — #1 워크플로 학습.
 *
 * 성공한 task 의 실행 절차(브라우저 액션 시퀀스 / 스크립트)를 파라미터화해 저장(skill_save)하고,
 * 유사 goal 의 새 task 에서 LLM 재추론 없이 재생(skill_run)한다. 선언형 프롬프트 스킬과 같은
 * `agent_skills` 테이블에 category='procedural' 로 공존한다 — 신규 테이블·마이그레이션 없음.
 *
 * 설계 원칙(task-learning 과 동일):
 *  - 무-LLM·결정적: 매칭은 goalSimilarity(키워드 자카드) 재사용.
 *  - 절대 throw 하지 않음(블록 생성): 실패 시 '' 반환(작업 시작을 막지 않음).
 *  - 소유자 격리: 재생은 본인 소유 스킬만.
 *
 * @module services/agent-task/procedural-skill
 */
import { SkillRepository } from '../../data/repositories/skill-repository';
import { getPool } from '../../data/models/unified-database';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { goalSimilarity } from './task-learning';
import { createLogger } from '../../utils/logger';
import { getSkillRuntime } from '../../runtime-ports/skill-runtime';
import { PROCEDURAL_SKILL } from '../../config/procedural-skill';
export { findPlaintextSecrets } from './procedural-secrets';
import { dropDormantSkills } from './procedural-dormancy';
import { PROCEDURAL_SAVE_HINT_LINES, PROCEDURAL_REUSE_LINES } from '../../prompts/procedural-skill-prompt';

const logger = createLogger('ProceduralSkill');

/** 절차 스킬을 선언형 스킬과 구분하는 카테고리. */
export const PROCEDURAL_CATEGORY = 'procedural';

/** 재생 가능 절차 스펙 — agent_skills.content 에 JSON 으로 저장. */
export interface ProceduralSpec {
    kind: 'browser' | 'script';
    /** 이 절차가 달성하는 목표(원문) — 향후 매칭 기준. */
    goal: string;
    /** 재생 시 {{name}} 치환에 쓰는 파라미터 이름 목록. */
    params?: string[];
    /** kind='browser': browser 도구와 동일한 액션 배열 + 허용 도메인. */
    actions?: unknown[];
    allowlist?: string[];
    /** kind='script': 언어 + 코드. */
    lang?: 'bash' | 'python';
    code?: string;
}

interface MatchedSkill {
    id: string;
    name: string;
    goal: string;
    params: string[];
    sim: number;
}

function getRepo(): SkillRepository {
    return new SkillRepository(getPool());
}

/** PURE: 텍스트 내 {{name}} 를 params 로 치환. 미정의 키는 원문 보존. */
export function applyParams(text: string, params: Record<string, string>): string {
    return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (k in params ? params[k] : m));
}

/** PURE: 문자열 리프에만 재귀 치환(JSON 구조 보존 — 값에 따옴표가 있어도 안전). */
export function deepApplyParams<T>(v: T, params: Record<string, string>): T {
    if (typeof v === 'string') return applyParams(v, params) as unknown as T;
    if (Array.isArray(v)) return v.map((x) => deepApplyParams(x, params)) as unknown as T;
    if (v && typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>)) {
            o[k] = deepApplyParams((v as Record<string, unknown>)[k], params);
        }
        return o as unknown as T;
    }
    return v;
}

/** PURE: content(JSON) 안전 파싱. 형식 불충족 시 null. */
export function parseSpec(content: string): ProceduralSpec | null {
    try {
        const o = JSON.parse(content) as ProceduralSpec;
        if (!o || (o.kind !== 'browser' && o.kind !== 'script')) return null;
        if (o.kind === 'browser' && !Array.isArray(o.actions)) return null;
        if (o.kind === 'script' && typeof o.code !== 'string') return null;
        return o;
    } catch {
        return null;
    }
}

/** 절차 스킬 저장 → skill id. spec.goal 미지정 시 description 으로 채운다. */
export async function saveProceduralSkill(
    userId: string,
    name: string,
    description: string,
    spec: ProceduralSpec,
): Promise<string> {
    const desc = (description || spec.goal || name).slice(0, PROCEDURAL_SKILL.DESCRIPTION_MAX_CHARS);
    const stored: ProceduralSpec = { ...spec, goal: spec.goal || desc };
    const skill = await getRepo().createSkill({
        name: name.slice(0, PROCEDURAL_SKILL.NAME_MAX_CHARS),
        description: desc,
        content: JSON.stringify(stored),
        category: PROCEDURAL_CATEGORY,
        isPublic: false,
        createdBy: userId,
    });
    logger.info(`[Procedural] 저장: "${skill.name}" (user ${userId}, kind ${spec.kind}, id ${skill.id})`);
    return skill.id;
}

/** 해석된 절차 — 스펙에 스킬 id 를 붙인다(재생 결과 기록용). */
export type ResolvedProcedure = ProceduralSpec & { id: string };

/** id 로 절차 스펙 로드 — 본인 소유(또는 public) 이고 category='procedural' 인 경우만. 조회는 기록하지 않는다. */
async function loadProceduralSpec(userId: string, skillId: string): Promise<ResolvedProcedure | null> {
    const skill = await getRepo().getSkillById(skillId).catch(() => null);
    if (!skill || skill.category !== PROCEDURAL_CATEGORY) return null;
    if (skill.createdBy && skill.createdBy !== userId && !skill.isPublic) return null;
    const spec = parseSpec(skill.content);
    return spec ? { ...spec, id: skill.id } : null;
}

/**
 * 재생 결과 기록(skill_audit_log) — 재생이 끝난 뒤 한 번만 부른다.
 * 종전에는 조회 때 기록해, 승인 결속과 실행이 각각 조회하면서 재생 1회에 2건이 남고 성공·실패도 알 수 없었다.
 */
export function recordProceduralRun(userId: string, run: { skillId: string; kind: ProceduralSpec['kind']; status: 'ok' | 'error'; durationMs: number }): void {
    getSkillRuntime().recordUsage([{
        skillId: run.skillId, kind: 'skill_run', userId, args: { kind: run.kind }, status: run.status, durationMs: run.durationMs,
    }]);
}

/**
 * id 우선 해석 — 정확한 skill_id 미스 시, 본인 절차 스킬 중 name/goal 퍼지 매칭으로 해석.
 * 라이브 관찰: 모델이 주입된 exact skill_id 대신 의미 이름("square" 등)을 지어내 호출 →
 * 퍼지 폴백이 없으면 재생이 전부 실패한다.
 */
export async function resolveProceduralSpec(userId: string, idOrName: string): Promise<ResolvedProcedure | null> {
    const exact = await loadProceduralSpec(userId, idOrName);
    if (exact) return exact;
    const res = await getRepo()
        .searchSkills({ userId, category: PROCEDURAL_CATEGORY, status: 'active', limit: PROCEDURAL_SKILL.SEARCH_LIMIT })
        .catch(() => null);
    if (!res || res.skills.length === 0) return null;
    const candidates = await dropDormantSkills(res.skills);
    const q = idOrName.toLowerCase().replace(/[_-]/g, ' ').trim();
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    let best: ResolvedProcedure | null = null;
    let bestScore = 0;
    const stem = PROCEDURAL_SKILL.STEM_PREFIX_CHARS;
    for (const s of candidates) {
        const spec = parseSpec(s.content);
        if (!spec) continue;
        const hay = `${s.name} ${spec.goal ?? ''}`.toLowerCase();
        const hayWords = hay.split(/\s+/).filter((w) => w.length > 2);
        // 부분일치 또는 형태변형(접두 5자 공유: square↔squaring) 매칭.
        const contains = hay.includes(q) || words.some((w) =>
            hay.includes(w) || hayWords.some((hw) => w.length >= stem && hw.slice(0, stem) === w.slice(0, stem)));
        const score = Math.max(goalSimilarity(idOrName, spec.goal ?? s.name), contains ? PROCEDURAL_SKILL.FUZZY_CONTAINS_SCORE : 0);
        if (score > bestScore) { bestScore = score; best = { ...spec, id: s.id }; }
    }
    return bestScore >= PROCEDURAL_SKILL.FUZZY_MIN_SCORE ? best : null;
}

/** goal 유사 절차 스킬 상위 N(임계 이상). */
async function findMatchingSkills(userId: string, goal: string): Promise<MatchedSkill[]> {
    const res = await getRepo()
        .searchSkills({ userId, category: PROCEDURAL_CATEGORY, status: 'active', limit: PROCEDURAL_SKILL.SEARCH_LIMIT })
        .catch(() => null);
    if (!res) return [];
    return (await dropDormantSkills(res.skills))
        .map((s) => {
            const spec = parseSpec(s.content);
            const g = spec?.goal || s.description || s.name;
            return { id: s.id, name: s.name, goal: g, params: spec?.params ?? [], sim: goalSimilarity(goal, g) };
        })
        .filter((m) => m.sim >= AGENT_TASK_LIMITS.LEARNING_MIN_SIMILARITY)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, AGENT_TASK_LIMITS.PROCEDURAL_MAX_SUGGEST);
}

/**
 * system 프롬프트에 덧붙일 "재사용 가능한 절차" 블록('' 이면 미주입).
 * 유사 절차가 있으면 모델이 skill_run 으로 재추론 없이 재생하도록 유도한다.
 */
export async function buildProceduralSkillBlock(userId: string, goal: string): Promise<string> {
    if (!AGENT_TASK_LIMITS.PROCEDURAL_SKILLS_ENABLED) return '';
    const saveHint = PROCEDURAL_SAVE_HINT_LINES;
    try {
        const matches = await findMatchingSkills(userId, goal);
        if (matches.length === 0) return saveHint.join('\n');
        logger.info(`[Procedural] 재사용 후보 ${matches.length}건 주입 (user ${userId})`);
        const lines = matches.map(
            (m) => `- skill_id=${m.id} "${m.name}"${m.params.length ? ` (params: ${m.params.join(', ')})` : ''}`,
        );
        return [
            ...saveHint,
            ...PROCEDURAL_REUSE_LINES,
            ...lines,
        ].join('\n');
    } catch (e) {
        logger.debug(`[Procedural] 매칭 조회 실패 — 저장 힌트만 주입: ${e instanceof Error ? e.message : e}`);
        return saveHint.join('\n');
    }
}
