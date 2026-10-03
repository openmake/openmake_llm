/**
 * 접기 뒤 회상 평가 — 긴 대화 각본을 컨텍스트 줄이기(접기·인계 요약)에 통과시킨 뒤,
 * 사라진 구간의 사실이 스텁·요약에 남았는지를 결정적으로 채점한다(LLM 호출 없음).
 *
 * 왜 필요한가: 접기는 단위 테스트만 있었고, 과제 묶음(golden-agent-tasks)은 평균 3턴이라 접기가 발동하지 않는다.
 * 스텁·요약 규칙을 바꿨을 때 "무엇을 했고 결과가 어땠나"가 여전히 남는지 볼 수단이 없었다.
 *
 * 사실은 두 종류로 적는다(라벨은 사용자 의도 기준 — 구현 출력에 맞춰 고치지 않는다):
 *  - required: 줄인 뒤에도 에이전트가 알아야 하는 것 — 실행한 명령·경로·질의, 성패·종료 코드, 오류 원인 줄.
 *    하나라도 사라지면 실패다.
 *  - 그 밖(content): 결과 본문 속 내용. 접기는 본문을 버리는 방식이라 대부분 사라진다 — 게이트는 걸지 않고
 *    남은 비율만 낸다(본문을 메모로 옮기는 것은 모델 몫이고 이 평가의 범위가 아니다).
 *
 * 채점 대상은 줄이기로 바뀌거나 없어진 턴의 사실뿐이다. 남은 근거는 스텁과 인계 요약의 본문에서만 찾는다
 * (assistant 메시지에 남은 호출 인자는 세지 않는다 — 스텁·요약이 스스로 설명되는지를 본다).
 *
 * @module evaluation/compaction-recall-evaluator
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { foldOldToolResults, isFoldedToolResult } from '../services/agent-task/context-fold';
import { compactWithHandoff, isHandoffSummary } from '../services/agent-task/context-handoff';
import { estimateConversationTokens } from '../services/agent-task/context-estimate';
import type { ChatMessage } from '../llm/types';

/** text 가 배열이면 그 문구들이 스텁·요약의 **같은 줄**에 함께 있어야 한다(명령과 그 명령의 성패가 짝으로 남았는지). */
const factSchema = z.object({
    id: z.string().min(1),
    text: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    required: z.boolean().optional(),
}).strict();
const turnSchema = z.object({
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    /** 도구 결과 — `{{filler:N}}` 은 N자 안팎의 채움 본문으로 편다. */
    result: z.string(),
    facts: z.array(factSchema).optional(),
}).strict();
const scenarioSchema = z.object({
    id: z.string().min(1),
    description: z.string().optional(),
    goal: z.string().min(1),
    turns: z.array(turnSchema).min(1),
}).strict();
const goldenSchema = z.object({ version: z.string(), description: z.string().optional(), scenarios: z.array(scenarioSchema).min(1) }).strict();

export type CompactionScenario = z.infer<typeof scenarioSchema>;
export type CompactionGolden = z.infer<typeof goldenSchema>;

/** 줄이기 정책 — 접기만 / 인계 요약만 / 접은 뒤 인계 요약(실제 순서). */
export const COMPACTION_POLICIES = ['fold', 'handoff', 'fold+handoff'] as const;
export type CompactionPolicy = typeof COMPACTION_POLICIES[number];

/** 인계 요약 정책에서 줄이는 목표 — 원래 추정의 이 비율까지. */
const HANDOFF_TARGET_RATIO = 0.3;

const FILLER = /\{\{filler:(\d+)\}\}/g;

/** PURE: 정해진 길이의 채움 본문 — 매번 같은 내용이고 사실 문구와 겹치지 않는다. */
function filler(chars: number): string {
    const lines: string[] = [];
    for (let i = 1, used = 0; used < chars; i++) {
        const line = `log ${String(i).padStart(5, '0')} ok ................................`;
        lines.push(line);
        used += line.length + 1;
    }
    return lines.join('\n');
}

/** PURE: 각본을 대화로 편다 — system, 목표, 그리고 턴마다 assistant(tool_calls) + tool 결과. */
export function buildScenarioConversation(s: CompactionScenario): ChatMessage[] {
    const c: ChatMessage[] = [{ role: 'system', content: 'system' }, { role: 'user', content: s.goal }];
    s.turns.forEach((t, i) => {
        c.push({ role: 'assistant', content: '', tool_calls: [{ id: `t${i}`, type: 'function', function: { name: t.tool, arguments: t.args } }] });
        c.push({ role: 'tool', content: t.result.replace(FILLER, (_m, n: string) => filler(Number(n))), tool_name: t.tool, tool_call_id: `t${i}` });
    });
    return c;
}

function applyPolicy(conversation: ChatMessage[], policy: CompactionPolicy): void {
    if (policy !== 'handoff') {
        foldOldToolResults(conversation, {
            keepTurns: AGENT_TASK_LIMITS.CONTEXT_FOLD_KEEP_TURNS,
            minChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_MIN_CHARS,
            headChars: AGENT_TASK_LIMITS.CONTEXT_FOLD_HEAD_CHARS,
            minBatchSavedChars: 0,
        });
    }
    if (policy !== 'fold') {
        compactWithHandoff(conversation, Math.floor(estimateConversationTokens(conversation) * HANDOFF_TARGET_RATIO), estimateConversationTokens);
    }
}

interface Tally { kept: number; total: number }

export interface CompactionScenarioResult {
    scenarioId: string;
    policy: CompactionPolicy;
    /** 줄이기로 결과가 바뀌거나 없어진 턴 수. */
    vanishedTurns: number;
    required: Tally;
    content: Tally;
    /** 사라진 required 사실의 id. */
    lostRequired: string[];
}

/** PURE: 각본 하나를 정책 하나에 통과시켜 채점한다. */
export function evaluateCompactionScenario(s: CompactionScenario, policy: CompactionPolicy): CompactionScenarioResult {
    const before = buildScenarioConversation(s);
    const after = before.map((m) => ({ ...m }));
    applyPolicy(after, policy);

    const afterById = new Map(after.filter((m) => m.role === 'tool').map((m) => [m.tool_call_id, m.content]));
    // 남은 근거 — 접힌 스텁과 인계 요약의 본문.
    const evidence = after
        .filter((m) => (m.role === 'tool' && isFoldedToolResult(m.content)) || (m.role === 'user' && isHandoffSummary(m.content)))
        .flatMap((m) => m.content.split('\n'));
    const kept = (text: string | string[]): boolean => {
        const parts = Array.isArray(text) ? text : [text];
        return evidence.some((line) => parts.every((p) => line.includes(p)));
    };

    const result: CompactionScenarioResult = {
        scenarioId: s.id, policy, vanishedTurns: 0, required: { kept: 0, total: 0 }, content: { kept: 0, total: 0 }, lostRequired: [],
    };
    s.turns.forEach((t, i) => {
        const original = before[2 + i * 2 + 1].content;
        if (afterById.get(`t${i}`) === original) return; // 원문이 그대로 남은 턴 — 채점 대상이 아니다
        result.vanishedTurns++;
        for (const f of t.facts ?? []) {
            const tally = f.required ? result.required : result.content;
            tally.total++;
            if (kept(f.text)) tally.kept++;
            else if (f.required) result.lostRequired.push(f.id);
        }
    });
    return result;
}

const DEFAULT_COMPACTION_GOLDEN = path.resolve(__dirname, 'golden-compaction.json');

export function loadCompactionGolden(filePath: string = DEFAULT_COMPACTION_GOLDEN): CompactionGolden {
    return goldenSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export interface CompactionGoldenSummary {
    version: string;
    policies: Array<{ policy: CompactionPolicy; required: Tally; content: Tally; vanishedTurns: number }>;
    results: CompactionScenarioResult[];
    failures: Array<{ id: string; reason: string }>;
}

/** PURE: 골든 각본 전부를 정책별로 채점한다. required 사실이 사라졌거나 사라진 턴이 없으면 실패. */
export function runCompactionGolden(golden: CompactionGolden): CompactionGoldenSummary {
    const results: CompactionScenarioResult[] = [];
    const failures: CompactionGoldenSummary['failures'] = [];
    const policies = COMPACTION_POLICIES.map((policy) => {
        const sum = { policy, required: { kept: 0, total: 0 }, content: { kept: 0, total: 0 }, vanishedTurns: 0 };
        for (const s of golden.scenarios) {
            const r = evaluateCompactionScenario(s, policy);
            results.push(r);
            sum.required.kept += r.required.kept; sum.required.total += r.required.total;
            sum.content.kept += r.content.kept; sum.content.total += r.content.total;
            sum.vanishedTurns += r.vanishedTurns;
            if (r.vanishedTurns === 0) failures.push({ id: `${s.id}/${policy}`, reason: '사라진 턴이 없다 — 각본이 짧아 평가가 아무것도 재지 않는다' });
            if (r.lostRequired.length > 0) failures.push({ id: `${s.id}/${policy}`, reason: `사라진 사실: ${r.lostRequired.join(', ')}` });
        }
        return sum;
    });
    return { version: golden.version, policies, results, failures };
}
