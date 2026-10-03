/**
 * 에이전트 작업 과제 묶음(golden-agent-tasks.json) 스키마 — 과제 정의가 깨지지 않았는지 CI 에서 본다.
 *
 * `cases` 는 네트워크 없는 샌드박스에서 끝나는 과제로, 야간 회귀 감시(eval:agent-tasks)가 실제로 실행한다.
 * `browserCases` 는 브라우저를 쓰는 과제다 — 외부 페이지에 의존해 야간 실행 묶음에는 넣지 않고 정의만 둔다.
 * 성공은 최종 답변에 정답 문자열이 들어 있는지로 판정한다(judgeExpectedAnswer).
 *
 * @module evaluation/agent-task-dataset
 */
import { z } from 'zod';
import { parseTrajectorySpec } from './trajectory-evaluator';

const caseSchema = z.object({
    id: z.string().min(1),
    goal: z.string().min(1),
    maxTurns: z.number().int().positive(),
    spec: z.unknown(),
    note: z.string().optional(),
    files: z.array(z.object({ name: z.string().min(1), type: z.string().optional(), content: z.string() }).strict()).optional(),
}).passthrough();

const browserCaseSchema = caseSchema.extend({
    /** 정답 문자열 — 최종 답변에 모두 들어 있어야 성공(대소문자 무시). */
    expectedAnswer: z.object({ includes: z.array(z.string().min(1)).min(1) }).strict(),
});

const datasetSchema = z.object({
    version: z.string().min(1),
    cases: z.array(caseSchema).min(1),
    browserCases: z.array(browserCaseSchema).optional(),
}).passthrough();

export type AgentTaskBrowserCase = z.infer<typeof browserCaseSchema>;
export type AgentTaskDataset = z.infer<typeof datasetSchema>;

/** 과제 묶음 검증 — 형식, 궤적 기대(spec), id 중복, 브라우저 과제의 도구 기대를 본다. 어긋나면 던진다. */
export function parseAgentTaskDataset(raw: unknown): AgentTaskDataset {
    const dataset = datasetSchema.parse(raw);
    const ids = new Set<string>();
    for (const c of [...dataset.cases, ...(dataset.browserCases ?? [])]) {
        if (ids.has(c.id)) throw new Error(`과제 id 중복: ${c.id}`);
        ids.add(c.id);
        const spec = parseTrajectorySpec(c.spec);
        if (spec.id !== c.id) throw new Error(`과제 ${c.id}: spec.id 가 다르다(${spec.id})`);
    }
    for (const c of dataset.browserCases ?? []) {
        const spec = parseTrajectorySpec(c.spec);
        if (!spec.requiredTools?.includes('browser')) throw new Error(`브라우저 과제 ${c.id}: requiredTools 에 browser 가 없다`);
        if (spec.forbiddenTools?.includes('browser')) throw new Error(`브라우저 과제 ${c.id}: browser 를 금지하고 있다`);
    }
    return dataset;
}

/** PURE: 정답 문자열 판정 — 기대 문자열이 모두 답변에 들어 있으면 성공(대소문자 무시). */
export function judgeExpectedAnswer(expected: { includes: readonly string[] }, answer: string | null | undefined): boolean {
    const a = (answer ?? '').toLowerCase();
    return expected.includes.every((s) => a.includes(s.toLowerCase()));
}
