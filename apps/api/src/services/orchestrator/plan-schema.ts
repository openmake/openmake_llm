/**
 * @module services/orchestrator/plan-schema
 * @description Planner 출력 계약 — Zod 검증(구조) + 의미 검증(id 유일·capability 허용·순환·상한) + 레벨 분해.
 * 순수 모듈(LLM·DB 없음) — 테스트로 고정한다.
 */
import { z } from 'zod';
import { isCapability, ORCHESTRATOR, PLAN_LYRICS_REF_MAX_CHARS, type Capability } from '../../config/capabilities';
import { snapshotForExecution } from '../../runtime-ports/capability-runtime';
import { ensureLegacyCapabilityBridge } from '../../addon-host/legacy-capability-bridge';

const PLAN_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const planTaskSchema = z.object({
    id: z.string().regex(PLAN_ID_RE),
    capability: z.string().min(1).max(40),
    input: z.object({
        instruction: z.string().max(4000).optional(),
        /** 낭독·합성·생성에 그대로 쓸 확정 콘텐츠(지시문과 구분). 없으면 refs 본문 → 사용자 원문 순 */
        text: z.string().max(20000).optional(),
        attachments: z.array(z.string().max(64)).max(16).optional(),
        refs: z.array(z.string().regex(PLAN_ID_RE)).max(16).optional(),
    }).loose().optional(),
    depends_on: z.array(z.string().regex(PLAN_ID_RE)).max(16).optional(),
});

const planSchema = z.object({
    complexity: z.enum(['simple', 'multi']),
    language: z.string().max(16).optional(),
    tasks: z.array(planTaskSchema).min(1).max(ORCHESTRATOR.MAX_TASKS),
    synthesis: z.boolean().optional(),
});

export interface PlanTask {
    id: string;
    capability: Capability;
    instruction: string;
    /** 확정 콘텐츠(TTS 낭독문 등) — 지시문(instruction)과 구분 */
    text: string;
    attachments: string[];
    refs: string[];
    dependsOn: string[];
    /** passthrough 로 들어온 추가 인자(size·voice 등) — executor 가 화이트리스트로 걸러 쓴다 */
    extra: Record<string, unknown>;
}

export interface ValidatedPlan {
    complexity: 'simple' | 'multi';
    language?: string;
    synthesis: boolean;
    tasks: PlanTask[];
    /** depends_on 위상 정렬 레벨 — 같은 레벨은 병렬 */
    levels: PlanTask[][];
}

/** vLLM json_schema / OpenAI response_format 용 JSON Schema (Zod 와 같은 형태) */
export const PLAN_JSON_SCHEMA = {
    type: 'object',
    properties: {
        complexity: { type: 'string', enum: ['simple', 'multi'] },
        language: { type: 'string' },
        tasks: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    capability: { type: 'string' },
                    input: {
                        type: 'object',
                        properties: {
                            instruction: { type: 'string' },
                            text: { type: 'string' },
                            attachments: { type: 'array', items: { type: 'string' } },
                            refs: { type: 'array', items: { type: 'string' } },
                            // 인자 키도 선언해야 한다 — 스키마 강제 디코딩(vLLM xgrammar 등)은 선언 안 된 키를 만들지 않아
                            // 영상 길이·크기가 한 번도 전달되지 않았다(구조화 출력 planner 의 작업 904개 중 extra 0건, 2026-09-22)
                            seconds: { type: 'string' },
                            size: { type: 'string' },
                            negative_prompt: { type: 'string' },
                            duration: { type: 'string' },
                            lyrics: { type: 'string' },
                        },
                    },
                    depends_on: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'capability'],
            },
        },
        synthesis: { type: 'boolean' },
    },
    required: ['complexity', 'tasks'],
} as const;

/** 모델 출력에서 JSON 객체를 뽑는다 — 펜스·앞뒤 잡음 허용(전체 파싱 먼저, 실패 시 첫 `{`~마지막 `}`) */
/** 잘린 출력의 머리에서 단순 계획 여부·언어를 읽는 구조 패턴(JSON 키 형태) */
const TRUNCATED_SIMPLE_HEAD_RE = /^\s*(?:```(?:json)?\s*)?\{\s*"complexity"\s*:\s*"simple"/i;
const TRUNCATED_LANGUAGE_RE = /"language"\s*:\s*"([A-Za-z-]{2,16})"/;

/**
 * 출력 상한에 잘려 JSON 이 닫히지 않았지만 머리가 `{"complexity":"simple"` 인 계획을 단순 계획으로 살린다.
 * 단순 계획은 작업 목록을 쓰지 않고 종전 채팅 경로로 가므로(orchestrate.ts) 잘린 작업 설명을 잃어도 결과가 같다 —
 * 재시도(수 초~수십 초)를 아낀다. 단순이 아니면 null(종전대로 재시도·폴백).
 */
export function salvageTruncatedSimplePlan(text: string, message: string, knownAttachmentIds?: ReadonlySet<string>, plannable?: ReadonlySet<string>): ValidatedPlan | null {
    if (!TRUNCATED_SIMPLE_HEAD_RE.test(text)) return null;
    const language = TRUNCATED_LANGUAGE_RE.exec(text)?.[1];
    const v = validatePlan({
        complexity: 'simple',
        ...(language ? { language } : {}),
        synthesis: false,
        tasks: [{ id: 't1', capability: 'text.reason', input: { instruction: message.slice(0, ORCHESTRATOR.PLANNER_MESSAGE_MAX_CHARS) } }],
    }, knownAttachmentIds ?? new Set(), plannable);
    return v.ok ? v.plan : null;
}

export function extractPlanJson(text: string): unknown | null {
    const t = text.trim();
    try { return JSON.parse(t); } catch { /* fallthrough */ }
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* fallthrough */ } }
    const a = t.indexOf('{'); const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fallthrough */ } }
    return null;
}

type PlanValidation = { ok: true; plan: ValidatedPlan } | { ok: false; reason: string };

/** 기본 plannable 집합 — Registry 스냅샷(호출부가 같은 요청의 스냅샷을 넘기지 않았을 때) */
function defaultPlannable(): ReadonlySet<string> {
    ensureLegacyCapabilityBridge();
    return snapshotForExecution().plannable;
}

/**
 * 구조 + 의미 검증. 실패 사유는 Planner 재시도 프롬프트에 그대로 싣는다.
 * `plannable` 은 Planner 가 프롬프트·schema 에 쓴 **같은 스냅샷**의 집합(P03) — 생략하면 현재 Registry 스냅샷.
 */
export function validatePlan(raw: unknown, knownAttachmentIds: ReadonlySet<string>, plannable: ReadonlySet<string> = defaultPlannable()): PlanValidation {
    const parsed = planSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).slice(0, 3).join('; ')}` };
    const p = parsed.data;

    const ids = new Set<string>();
    const tasks: PlanTask[] = [];
    for (const t of p.tasks) {
        if (ids.has(t.id)) return { ok: false, reason: `duplicate task id '${t.id}'` };
        ids.add(t.id);
        if (!isCapability(t.capability)) return { ok: false, reason: `unknown capability '${t.capability}'` };
        if (!plannable.has(t.capability)) return { ok: false, reason: `capability '${t.capability}' is not plannable` };
        const { instruction, text, attachments, refs, ...extra } = t.input ?? {};
        for (const a of attachments ?? []) {
            if (!knownAttachmentIds.has(a)) return { ok: false, reason: `unknown attachment '${a}' in task '${t.id}'` };
        }
        tasks.push({
            id: t.id, capability: t.capability, instruction: (instruction ?? '').trim(), text: (text ?? '').trim(),
            attachments: attachments ?? [], refs: refs ?? [], dependsOn: t.depends_on ?? [], extra,
        });
    }
    for (const t of tasks) {
        // 가사 자리에 앞 작업 참조("REFS:t1"·"(lyrics from t1)")를 적은 경우 — 그 작업을 refs 로 옮긴다(그대로면 그 문자열을 노래한다)
        const lyrics = typeof t.extra.lyrics === 'string' ? t.extra.lyrics.trim() : '';
        if (lyrics && lyrics.length <= PLAN_LYRICS_REF_MAX_CHARS) {
            const named = [...ids].filter((id) => id !== t.id && new RegExp(`(^|[^A-Za-z0-9_-])${id}($|[^A-Za-z0-9_-])`).test(lyrics));
            if (named.length > 0) {
                delete t.extra.lyrics;
                for (const id of named) if (!t.refs.includes(id)) t.refs.push(id);
            }
        }
        for (const d of [...t.dependsOn, ...t.refs]) {
            if (!ids.has(d)) return { ok: false, reason: `task '${t.id}' references unknown task '${d}'` };
            if (d === t.id) return { ok: false, reason: `task '${t.id}' depends on itself` };
        }
        // refs 는 암묵적 의존 — depends_on 에 합친다
        for (const r of t.refs) if (!t.dependsOn.includes(r)) t.dependsOn.push(r);
    }

    // 위상 정렬 (Kahn) — 순환이면 실패
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const indeg = new Map(tasks.map((t) => [t.id, t.dependsOn.length]));
    let frontier = tasks.filter((t) => t.dependsOn.length === 0);
    const levels: PlanTask[][] = [];
    const seen = new Set<string>();
    while (frontier.length > 0) {
        if (frontier.length > ORCHESTRATOR.MAX_PARALLEL) return { ok: false, reason: `too many parallel tasks in one level (${frontier.length} > ${ORCHESTRATOR.MAX_PARALLEL})` };
        levels.push(frontier);
        for (const t of frontier) seen.add(t.id);
        const next: PlanTask[] = [];
        for (const t of tasks) {
            if (seen.has(t.id) || next.includes(t)) continue;
            const remaining = t.dependsOn.filter((d) => !seen.has(d)).length;
            indeg.set(t.id, remaining);
            if (remaining === 0) next.push(byId.get(t.id)!);
        }
        frontier = next;
    }
    if (seen.size !== tasks.length) return { ok: false, reason: 'dependency cycle detected' };

    // simple 인데 텍스트 하나가 아니면 거절 대신 multi 로 보정한다 — 모델이 "이미지 하나 = simple" 로 적는 경우가 잦아
    // 재시도(추가 왕복)를 만들지 않는다(라이브 2026-09-12). 텍스트 여러 개도 multi.
    const complexity: 'simple' | 'multi' = p.complexity === 'simple' && tasks.length === 1 && tasks[0].capability.startsWith('text.') ? 'simple' : 'multi';
    return {
        ok: true,
        plan: { complexity, language: p.language, synthesis: p.synthesis ?? complexity === 'multi', tasks, levels },
    };
}
