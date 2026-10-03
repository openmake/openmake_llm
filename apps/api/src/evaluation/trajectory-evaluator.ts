/**
 * 에이전트 작업 궤적의 과정 검사 (trajectory 평가, README "후속 작업" 3번의 결정적 부분).
 *
 * 최종 답이 맞아도 과정이 틀린 실행을 잡는다 — 필수 도구를 건너뛰었거나, 허용되지 않은 도구를 썼거나,
 * 인자·순서·호출 횟수가 명세와 다른 경우다(Process-Level Evaluation, arXiv 2610.01833 의 네 차원).
 * LLM 없이 스텝 기록만으로 판정한다. 결과의 의미 판정(goal judge)은 이 모듈의 범위가 아니다.
 *
 * 한 도구가 아예 쓰이지 않았으면 그 도구의 인자·순서 검사는 실패가 아니라 건너뜀으로 두고 원인 검사에 묶는다
 * (dependsOn) — 원인 하나가 여러 실패로 부풀어 보이지 않게 한다.
 *
 * @module evaluation/trajectory-evaluator
 */
import { z } from 'zod';

const argMatcher = z.union([z.string(), z.number(), z.boolean(), z.object({ regex: z.string().min(1) }).strict()]);

const specSchema = z.object({
    id: z.string().min(1),
    description: z.string().optional(),
    /** 선택 — 반드시 한 번 이상 호출돼야 하는 도구 */
    requiredTools: z.array(z.string().min(1)).optional(),
    /** 선택 — 있으면 이 목록 밖의 도구 호출은 위반 */
    allowedTools: z.array(z.string().min(1)).optional(),
    /** 선택 — 호출되면 안 되는 도구 */
    forbiddenTools: z.array(z.string().min(1)).optional(),
    /** 인자 — 해당 도구의 호출 중 하나라도 모든 키가 맞으면 통과 */
    expectedArgs: z.array(z.object({ tool: z.string().min(1), args: z.record(z.string(), argMatcher) }).strict()).optional(),
    /** 순서 — before 의 첫 호출이 after 의 첫 호출보다 앞 */
    order: z.array(z.object({ before: z.string().min(1), after: z.string().min(1) }).strict()).optional(),
    /** 범위 — 도구별 호출 횟수 상한 */
    maxCalls: z.record(z.string(), z.number().int().nonnegative()).optional(),
}).strict();

export type TrajectorySpec = z.infer<typeof specSchema>;
export interface TrajectoryCall { name: string; args: Record<string, unknown> }
export type TrajectoryDimension = 'selection' | 'argument' | 'order' | 'scope';

export interface TrajectoryCheck {
    id: string;
    dimension: TrajectoryDimension;
    status: 'pass' | 'fail' | 'skipped';
    detail: string;
    /** 건너뛴 이유가 된 검사 id */
    dependsOn?: string;
}

export interface TrajectoryResult {
    specId: string;
    passed: boolean;
    checks: TrajectoryCheck[];
    /** 실패한 검사 id — 건너뜀은 원인 검사에 묶여 여기 들어오지 않는다 */
    rootFailures: string[];
}

/** 명세 검증 — 모르는 필드·잘못된 정규식은 던진다(오타 난 명세가 검사 없이 통과하지 않게). */
export function parseTrajectorySpec(raw: unknown): TrajectorySpec {
    const spec = specSchema.parse(raw);
    for (const e of spec.expectedArgs ?? []) {
        for (const m of Object.values(e.args)) if (typeof m === 'object') new RegExp(m.regex);
    }
    return spec;
}

function argMatches(matcher: z.infer<typeof argMatcher>, value: unknown): boolean {
    if (typeof matcher === 'object') return typeof value === 'string' && new RegExp(matcher.regex).test(value);
    return value === matcher;
}

/** PURE: 궤적(도구 호출 순서열)을 명세와 대조한다. */
export function evaluateTrajectory(spec: TrajectorySpec, calls: readonly TrajectoryCall[]): TrajectoryResult {
    const checks: TrajectoryCheck[] = [];
    const firstIndex = (tool: string): number => calls.findIndex((c) => c.name === tool);
    const used = new Set(calls.map((c) => c.name));
    const required = new Set(spec.requiredTools ?? []);
    /** 필수 도구가 빠졌으면 그 검사 id — 딸린 검사를 건너뜀으로 묶는다 */
    const missingRoot = (tool: string): string | undefined => (required.has(tool) && !used.has(tool) ? `required:${tool}` : undefined);
    const skip = (id: string, dimension: TrajectoryDimension, root: string): void => {
        checks.push({ id, dimension, status: 'skipped', detail: `${root} 실패로 건너뜀`, dependsOn: root });
    };

    for (const tool of spec.requiredTools ?? []) {
        const ok = used.has(tool);
        checks.push({ id: `required:${tool}`, dimension: 'selection', status: ok ? 'pass' : 'fail', detail: ok ? `${tool} 호출됨` : `${tool} 을 호출하지 않음` });
    }
    if (spec.allowedTools) {
        const allowed = new Set(spec.allowedTools);
        const outside = [...used].filter((t) => !allowed.has(t));
        checks.push({
            id: 'allowed', dimension: 'selection', status: outside.length === 0 ? 'pass' : 'fail',
            detail: outside.length === 0 ? '허용 목록 안의 도구만 사용' : `허용 목록 밖 도구 사용: ${outside.join(', ')}`,
        });
    }
    for (const tool of spec.forbiddenTools ?? []) {
        const ok = !used.has(tool);
        checks.push({ id: `forbidden:${tool}`, dimension: 'selection', status: ok ? 'pass' : 'fail', detail: ok ? `${tool} 미사용` : `금지 도구 ${tool} 사용` });
    }

    (spec.expectedArgs ?? []).forEach((e, i) => {
        const id = `args:${e.tool}#${i}`;
        const root = missingRoot(e.tool);
        if (root) return skip(id, 'argument', root);
        const ok = calls.some((c) => c.name === e.tool && Object.entries(e.args).every(([k, m]) => argMatches(m, c.args[k])));
        checks.push({ id, dimension: 'argument', status: ok ? 'pass' : 'fail', detail: ok ? `${e.tool} 인자 일치` : `${e.tool} 호출 중 기대 인자와 맞는 것이 없음: ${JSON.stringify(e.args)}` });
    });

    for (const o of spec.order ?? []) {
        const id = `order:${o.before}>${o.after}`;
        const root = missingRoot(o.before) ?? missingRoot(o.after);
        if (root) { skip(id, 'order', root); continue; }
        const b = firstIndex(o.before);
        const a = firstIndex(o.after);
        // after 가 없으면 어길 순서가 없다. before 가 없는데 after 만 있으면 위반.
        const ok = a < 0 || (b >= 0 && b < a);
        checks.push({ id, dimension: 'order', status: ok ? 'pass' : 'fail', detail: ok ? `${o.before} 가 ${o.after} 보다 앞` : `${o.before} 보다 ${o.after} 가 먼저 호출됨` });
    }

    for (const [tool, max] of Object.entries(spec.maxCalls ?? {})) {
        const n = calls.filter((c) => c.name === tool).length;
        checks.push({ id: `max:${tool}`, dimension: 'scope', status: n <= max ? 'pass' : 'fail', detail: `${tool} ${n}회 호출 (상한 ${max})` });
    }

    const rootFailures = checks.filter((c) => c.status === 'fail').map((c) => c.id);
    return { specId: spec.id, passed: rootFailures.length === 0, checks, rootFailures };
}

/** 스텝 행(agent_task_steps)의 필요한 필드만 */
export interface TrajectoryStepRow {
    step_number: number;
    step_type: string;
    tool_name: string | null;
    tool_args: unknown;
}

/** PURE: 스텝 기록 → 궤적. 도구 호출은 tool_result 스텝으로 남는다(인자는 tool_args — JSON 문자열일 수 있다). */
export function stepsToTrajectory(steps: readonly TrajectoryStepRow[]): TrajectoryCall[] {
    return [...steps]
        .filter((s) => s.step_type === 'tool_result' && !!s.tool_name)
        .sort((a, b) => a.step_number - b.step_number)
        .map((s) => {
            let args: unknown = s.tool_args;
            if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
            return { name: s.tool_name as string, args: args && typeof args === 'object' ? args as Record<string, unknown> : {} };
        });
}
