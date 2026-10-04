/**
 * 도구 호출 반복 가드 — 같은 호출이 연속으로 실패하거나 같은 결과만 돌려줄 때 안내하고, 임계를 넘으면 실행하지 않는다.
 * 서로 다른 호출 두세 개가 같은 결과로 번갈아 되풀이되는 주기(A-B-A-B)도 같은 두 단계로 다룬다(cycleVerdict).
 *
 * 종전의 반복 감지(turn-guards.pushStuckSignature)는 응답 전체(본문 + 호출)가 완전히 같을 때만 걸려,
 * 본문이 조금만 달라도 같은 실패 호출을 되풀이하며 턴을 태웠다. 여기서는 호출 단위로 본다.
 *
 * 상태를 따로 들고 다니지 않고 대화에서 센다 — 재개(체크포인트 복원) 뒤에도 그대로 동작한다.
 * 모두 결정적 규칙이다(LLM 호출 없음).
 *
 * @module services/agent-task/tool-loop-guard
 */
import type { ChatMessage } from '../../llm/types';
import { hashApprovalArgs } from '../../data/repositories/agent-task-approval-repository';
import { getToolLoopBlockedResult, getToolLoopFailureNote, getToolLoopSameResultNote, LOCAL_BRIDGE_UNKNOWN_OUTCOME_MARKER, UNKNOWN_OUTCOME_PHRASE, UNKNOWN_OUTCOME_DECLINED_PHRASE } from '../../prompts/agent-task-prompt';
import { classifyBrowserAction } from '@openmake/config';
import { DUPLICATE_TOOL_CALL_PREFIX, TOOL_LOOP_NOTE_MARKER, getToolLoopCycleNote, getToolLoopCycleBlockedResult, getRereadNote } from '../../prompts/agent-task-turn-loop';
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { hasSideEffects } from '../../config/tool-policy';

interface PriorRepetition {
    /** 직전까지 같은 이름·인자로 연속 실패한 횟수. */
    failures: number;
    /** 직전까지 같은 이름·인자가 같은 결과를 돌려준 연속 횟수(실패 제외). */
    sameResult: number;
    /** 그 같은 결과의 본문(이번 결과와 비교용). */
    lastResult?: string;
}

interface LoopLimits {
    warnFailures: number;
    blockFailures: number;
    warnSameResult: number;
    blockSameResult: number;
}

/** PURE: 결과가 실패인가 — 데이터 래퍼(<tool_output>)에 싸여 있어도 본다. */
function isErrorResult(content: string): boolean {
    return /^(?:<tool_output>\s*)?Error:/.test(content);
}

/** 중복 호출 안내 결과 — 데이터 래퍼(<tool_output>)에 싸여 있어도 본다. */
const DUPLICATE_TOOL_CALL_RE = new RegExp(`^(?:<tool_output>\\s*)?${DUPLICATE_TOOL_CALL_PREFIX.replace(/[[\]]/g, '\\$&')}`);

const signature = (name: string, args: unknown): string => `${name}:${hashApprovalArgs((args ?? {}) as Record<string, unknown>)}`;

/** 결과 뒤에 붙인 반복 안내(한 줄) — 비교할 때는 뺀다. 안내가 붙었다고 "다른 결과"가 되면 반복이 끊긴 것으로 세어진다. */
const LOOP_NOTE_RE = new RegExp(`${TOOL_LOOP_NOTE_MARKER.replace(/[[\]]/g, '\\$&')}[^\n]*`, 'g');
const stripLoopNotes = (content: string): string => content.replace(LOOP_NOTE_RE, '');

interface DoneCall { sig: string; name: string; args: Record<string, unknown>; content: string }

/** PURE: 실행이 끝난 호출을 순서대로 — 서명과 (반복 안내를 뺀) 결과. */
function doneCalls(conversation: readonly ChatMessage[]): DoneCall[] {
    const callById = new Map<string, Omit<DoneCall, 'content'>>();
    const done: DoneCall[] = [];
    for (const m of conversation) {
        if (m.role === 'assistant') {
            for (const tc of m.tool_calls ?? []) {
                if (tc.id) callById.set(tc.id, { sig: signature(tc.function.name, tc.function.arguments), name: tc.function.name, args: (tc.function.arguments ?? {}) as Record<string, unknown> });
            }
        } else if (m.role === 'tool' && m.tool_call_id && callById.has(m.tool_call_id)) {
            const content = typeof m.content === 'string' ? m.content : '';
            // 한 응답 안의 중복 호출에 준 짧은 결과는 실행 결과가 아니다 — 집계에서 뺀다(같은 결과 연속이 끊기지 않게).
            if (DUPLICATE_TOOL_CALL_RE.test(content)) continue;
            done.push({ ...callById.get(m.tool_call_id)!, content: stripLoopNotes(content) });
        }
    }
    return done;
}

/** 결과 불명 쓰기를 다시 하려 할 때의 처리 — ask: 사용자에게 묻는다, declined: 이미 다시 실행하지 않기로 했으니 묻지 않고 막는다. */
export type UnknownOutcomeRetry = 'ask' | 'declined';

/** PURE: 호출 결과가 결과 불명 처리의 어느 단계인가 — 사용자가 거절한 안내 / 결과 불명 안내 / 그 밖(정상 결과). */
function unknownOutcomeStage(content: string): UnknownOutcomeRetry | null {
    if (content.includes(UNKNOWN_OUTCOME_DECLINED_PHRASE)) return 'declined';
    return content.includes(LOCAL_BRIDGE_UNKNOWN_OUTCOME_MARKER) || content.includes(UNKNOWN_OUTCOME_PHRASE) ? 'ask' : null;
}

/**
 * PURE: 한 호출이 "바꾸는 것"의 목록(키). 브라우저는 입력·누르기 액션 하나하나가 키다 — 읽기와 주소 이동은 뺀다
 * (같은 주소로 다시 가는 것은 되풀이해도 해가 없다). 그 밖의 도구는 호출 전체가 키 하나다.
 */
function effectKeys(name: string, args: unknown): string[] {
    const actions = name === 'browser' ? (args as { actions?: unknown } | null)?.actions : undefined;
    if (!Array.isArray(actions)) return [signature(name, args)];
    return actions
        .filter((a) => { const c = classifyBrowserAction(a); return c === 'write' || c === 'click'; })
        .map((a) => signature(name, a));
}

/**
 * PURE: 지금 하려는 호출이, 로컬 기기와 끊겨 **결과 불명으로 끝난 쓰기**를 다시 하려는 것인가 — 그렇다면 어떻게 다룰지.
 * 같은 쓰기의 가장 최근 결과로 정한다: 결과 불명 안내면 'ask'(사용자에게 묻는다), 사용자가 다시 실행하지 않기로 한 안내면
 * 'declined'(묻지 않고 막는다 — 같은 질문을 되풀이하지 않는다), 정상 결과면(사용자가 다시 실행을 승인했다) null.
 * 브라우저는 액션 단위로 본다: 모델이 호출을 쪼개거나 읽기를 덧붙여 다시 불러도 같은 입력·누르기가 하나라도 들어 있으면 해당한다.
 * 기기가 다시 연결되면 브라우저 탭 같은 상태가 초기화되어 모델이 "반영되지 않았다"고 보고 같은 쓰기를 되풀이하기 쉽다.
 * 제출처럼 되돌릴 수 없는 쓰기가 두 번 나가지 않게 한다.
 */
export function retryAfterUnknownOutcome(conversation: readonly ChatMessage[], name: string, args: unknown): UnknownOutcomeRetry | null {
    const stage = new Map<string, UnknownOutcomeRetry | null>(); // 쓰기 키 → 가장 최근 결과의 단계
    for (const c of doneCalls(conversation)) {
        const st = unknownOutcomeStage(c.content);
        for (const k of effectKeys(c.name, c.args)) stage.set(k, st);
    }
    const mine = effectKeys(name, args).map((k) => stage.get(k) ?? null);
    return mine.includes('ask') ? 'ask' : mine.includes('declined') ? 'declined' : null;
}

/**
 * PURE: 대화의 끝에서부터, 지금 하려는 호출(name, args)과 같은 호출이 연속으로 몇 번 있었는지 센다.
 * 다른 호출이 하나라도 끼면 거기서 멈춘다.
 */
export function priorRepetition(conversation: readonly ChatMessage[], name: string, args: unknown): PriorRepetition {
    const done = doneCalls(conversation);
    const want = signature(name, args);
    let failures = 0;
    let sameResult = 0;
    let lastResult: string | undefined;
    let countingFailures = true;
    let countingSame = true;
    for (let i = done.length - 1; i >= 0 && done[i].sig === want && (countingFailures || countingSame); i--) {
        const err = isErrorResult(done[i].content);
        if (countingFailures && err) failures++; else countingFailures = false;
        if (countingSame && !err && (lastResult === undefined || done[i].content === lastResult)) {
            sameResult++;
            lastResult = done[i].content;
        } else countingSame = false;
    }
    return { failures, sameResult, ...(lastResult !== undefined ? { lastResult } : {}) };
}

/**
 * PURE: 반복 판정 — block 이면 실행하지 않고 blockedResult 를 결과로 쓴다.
 * 아니면 실행한 뒤 noteFor(result) 가 돌려주는 안내('' 이면 없음)를 결과 뒤에 붙인다.
 * 같은 결과 반복은 읽기 전용 호출에만 적용한다(쓰기·실행은 같은 출력이 정상일 수 있다).
 */
export function repetitionVerdict(
    prior: PriorRepetition, call: { readOnly: boolean; toolName?: string }, limits: LoopLimits,
): { block: boolean; blockedResult: string; noteFor: (result: string) => string } {
    const blockByFailures = prior.failures >= limits.blockFailures;
    const blockBySame = call.readOnly && prior.sameResult >= limits.blockSameResult;
    return {
        block: blockByFailures || blockBySame,
        blockedResult: getToolLoopBlockedResult(call.toolName ?? 'tool', blockByFailures ? prior.failures : prior.sameResult, blockByFailures ? 'failure' : 'same_result'),
        noteFor: (result: string): string => {
            if (isErrorResult(result)) {
                const n = prior.failures + 1;
                return n >= limits.warnFailures ? getToolLoopFailureNote(n) : '';
            }
            if (call.readOnly && prior.lastResult !== undefined && result === prior.lastResult) {
                const n = prior.sameResult + 1;
                return n >= limits.warnSameResult ? getToolLoopSameResultNote(n) : '';
            }
            return '';
        },
    };
}

/**
 * PURE: 주기 판정 — 지금 하려는 호출이, 대화 끝에서 되풀이되고 있는 주기(서로 다른 호출 2~MAX_PERIOD 개가 서명도 결과도 같게 반복)를
 * 이어가는가. 이어가면 주기 길이, 이미 돈 바퀴 수, 이번 자리의 지난 결과를 돌려준다. 가장 짧은 주기를 쓴다.
 * 결과가 달라지는 번갈아 호출(편집 → 테스트에서 테스트 출력이 변함)은 주기의 다른 자리가 일치하지 않아 걸리지 않는다.
 */
function priorCycle(done: readonly DoneCall[], want: string): { period: number; laps: number; expected: string } | null {
    const n = done.length;
    for (let p = 2; p <= AGENT_TASK_TURN_LOOP.TOOL_LOOP_CYCLE_MAX_PERIOD; p++) {
        if (n < p || done[n - p].sig !== want) continue;
        // 한 호출의 연속 반복은 주기가 아니다(priorRepetition 몫).
        if (new Set(done.slice(n - p).map((d) => d.sig)).size < 2) continue;
        let matched = 0; // 끝에서부터, 한 주기 앞의 호출과 서명·결과가 같은 호출 수
        for (let i = n - 1; i - p >= 0 && done[i].sig === done[i - p].sig && done[i].content === done[i - p].content; i--) matched++;
        if (matched < p - 1) continue; // 주기의 나머지 자리가 한 번도 되풀이되지 않았다
        return { period: p, laps: Math.floor((matched + 1) / p), expected: done[n - p].content };
    }
    return null;
}

/**
 * 주기 반복 판정(repetitionVerdict 와 같은 두 단계) — block 이면 실행하지 않고 blockedResult 를 결과로 쓴다.
 * 아니면 실행한 뒤 noteFor(모델에 보일 결과)가 돌려주는 안내를 붙인다. 읽기 전용이 아니어도 본다 — 결과까지 같은 주기만 세기 때문이다.
 */
export function cycleVerdict(
    conversation: readonly ChatMessage[], name: string, args: unknown,
): { block: boolean; blockedResult: string; noteFor: (result: string) => string } {
    const cycle = AGENT_TASK_TURN_LOOP.TOOL_LOOP_CYCLE_ENABLED ? priorCycle(doneCalls(conversation), signature(name, args)) : null;
    if (!cycle) return { block: false, blockedResult: '', noteFor: () => '' };
    return {
        block: cycle.laps >= AGENT_TASK_TURN_LOOP.TOOL_LOOP_CYCLE_BLOCK,
        blockedResult: getToolLoopCycleBlockedResult(name, cycle.period, cycle.laps),
        noteFor: (result: string): string =>
            cycle.laps + 1 >= AGENT_TASK_TURN_LOOP.TOOL_LOOP_CYCLE_WARN && stripLoopNotes(result) === cycle.expected
                ? getToolLoopCycleNote(cycle.period, cycle.laps + 1) : '',
    };
}

/**
 * PURE: 같은 구간 다시 읽기 — 파일 보기(str_replace_editor view)가 앞서 읽은 같은 파일·같은 구간을 같은 내용으로 다시 돌려줬고,
 * 그 사이에 파일을 고칠 수 있는 호출(편집·셸 등 부작용 있는 호출)이 없었으면 결과 뒤에 붙일 짧은 안내를, 아니면 '' 를 돌려준다.
 * 같은 결과 반복 안내(3회째)를 기다리지 않고 2회째에 알린다. 내용은 그대로 돌려준다(차단하지 않는다).
 * 앞선 결과가 접히거나 인계 요약으로 바뀌어 모델이 볼 수 없으면 내용이 일치하지 않아 안내하지 않는다 — 그때의 다시 읽기는 정당하다.
 */
export function rereadNote(conversation: readonly ChatMessage[], name: string, args: unknown, result: string): string {
    const a = (args ?? {}) as Record<string, unknown>;
    if (!AGENT_TASK_TURN_LOOP.REREAD_NOTE_ENABLED || name !== 'str_replace_editor' || a.command !== 'view' || isErrorResult(result)) return '';
    const done = doneCalls(conversation);
    const want = signature(name, args);
    for (let i = done.length - 1; i >= 0; i--) {
        if (done[i].sig === want) return done[i].content === stripLoopNotes(result) ? getRereadNote() : '';
        if (hasSideEffects(done[i].name, done[i].args)) return '';
    }
    return '';
}
