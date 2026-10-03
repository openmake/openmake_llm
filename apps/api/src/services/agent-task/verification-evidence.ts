/**
 * 검증 증거 원장 — 대화 기록의 도구 호출에서 "파일을 바꿨는가"와 "그 뒤에 검증이 성공했는가"를 읽는다.
 *
 * 완료 관문의 테스트 게이트는 쓰기 도구 이름(bash 포함)만 보고 발동해, `ls` 만 한 작업도 테스트를 돌렸고
 * 모델이 방금 테스트를 돌려 통과했어도 같은 테스트를 한 번 더 돌렸다. 여기서는 호출을 순서대로 보며
 *   - 변경(편집 성공·코드 실행·읽기 전용이 아닌 셸 명령)이 나오면 앞선 검증 기록을 낡은 것으로 버리고,
 *   - 검증 명령이 종료 코드 0 으로 끝났으면 새 증거로 삼는다.
 * 애매하면 검증하는 쪽으로 기운다: 모르는 셸 명령은 변경, 종료 코드가 가려지는 명령(파이프·`|| true`·백그라운드)은 증거 아님,
 * 결과가 접혀 종료 코드 줄이 없으면 증거 아님, 기록에서 호출을 읽지 못하면 변경 있음.
 * 증거는 게이트가 돌릴 것과 같은 실행뿐이다 — 작업 공간 루트에서 게이트의 러너를 전체로 돌린 것(FULL_TEST_RUN_RES).
 * 일부 테스트만 돌린 것, 다른 디렉터리에서 돌린 것, 빌드·린트는 증거가 아니다.
 * 결정적 규칙이다(LLM 호출 없음). 발동 여부는 VERIFY_EVIDENCE.ENABLED(기본 꺼짐) — 호출부(finalize)가 본다.
 *
 * @module services/agent-task/verification-evidence
 */
import type { ChatMessage } from '../../llm/types';
import { FILE_MUTATING_CALLS, FULL_TEST_RUN_RES, READ_ONLY_COMMAND_RES, VERIFY_EVIDENCE, type GateTestRunner } from '../../config/agent-task-tools';
import { finishedToolCalls } from './tool-call-history';
import { isHandoffSummary } from './context-handoff';

export interface VerificationEvidence {
    /** 파일을 바꿨을 수 있는 호출이 있었는가. */
    mutated: boolean;
    /** 마지막 변경 이후 성공한 전체 테스트 실행(가장 최근 것)과 그 러너. 없으면 null. */
    freshPass: { command: string; runner: GateTestRunner } | null;
}

type ShellKind = 'read' | 'verify' | 'mutate';

/** 셸 결과의 종료 줄(task-sandbox/tools.ts 의 formatExec 형식). 출력이 같은 모양을 찍을 수 있어 마지막 것으로 판정한다. */
const EXIT_LINE_RE = /\[exit=(-?\d+)( TIMEOUT)?(?: TRUNCATED)? \d+ms\]/g;

/** PURE: 결과의 마지막 종료 줄이 0 이고 시간 초과가 아니다. */
function exitedOk(result: string): boolean {
    const last = [...result.matchAll(EXIT_LINE_RE)].pop();
    return last !== undefined && last[1] === '0' && last[2] === undefined;
}

/** 명령 앞의 환경변수 대입(`A=1 B=2 cmd`)을 떼어 낸다. */
const ENV_PREFIX_RE = /^((?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+)/;

/** PURE: 셸 명령을 토막으로 나눠 종류와(증거가 되면) 러너를 정한다. */
function analyzeShellCommand(command: string): { kind: ShellKind; runner: GateTestRunner | null } {
    // 따옴표 안은 비워 연산자·리다이렉션을 오인하지 않게 한다.
    const bare = command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/`|\$\(|<\(/.test(bare)) return { kind: 'mutate', runner: null };
    // 파일로 내보내는 리다이렉션(> >>) — /dev/null 과 2>&1 은 뺀다.
    if (/>>?\s*(?!\s*(?:\/dev\/null|&\d))/.test(bare.replace(/\d*>&\d+/g, ''))) return { kind: 'mutate', runner: null };
    const plain = bare.replace(/\d*>&\d+/g, ' ').replace(/\d*>>?\s*\/dev\/null/g, ' ');
    const parts = plain.split(/&&|\|\||[;|\n]/).map((p) => p.trim()).filter((p) => p.length > 0);
    let runner: GateTestRunner | null = null;
    let proven = true; // 증거가 될 수 있는가 — 루트에서, 범위를 바꾸는 환경변수 없이, 테스트 한 번
    for (const raw of parts) {
        const env = ENV_PREFIX_RE.exec(raw)?.[1].trim().split(/\s+/) ?? [];
        const p = raw.replace(ENV_PREFIX_RE, '');
        const hit = (Object.keys(FULL_TEST_RUN_RES) as GateTestRunner[]).find((r) => FULL_TEST_RUN_RES[r].test(p));
        if (hit) {
            if (runner !== null || !env.every((e) => VERIFY_EVIDENCE.EVIDENCE_ENV_RE.test(e))) proven = false;
            runner = hit;
        } else if (!READ_ONLY_COMMAND_RES.some((re) => re.test(p))) {
            return { kind: 'mutate', runner: null };
        } else if (/^cd\b/.test(p) && !VERIFY_EVIDENCE.ROOT_CD_RE.test(p)) {
            proven = false;
        }
    }
    // 테스트 명령이 있어도 종료 코드가 그 명령의 것이라고 볼 수 없으면(파이프·;·||) 증거로 치지 않는다. && 는 전부 성공해야 0 이다.
    if (runner === null || !proven || /\|\||[;|\n]/.test(plain)) return { kind: 'read', runner: null };
    return { kind: 'verify', runner };
}

/** PURE: 셸 명령이 읽기만 하는지, 검증 증거가 되는지, 파일을 바꿨을 수 있는지. */
export function classifyShellCommand(command: string): ShellKind {
    return analyzeShellCommand(command).kind;
}

/** PURE: 명령이 증거가 되는 전체 테스트 실행이면 그 러너, 아니면 null. */
export function provenTestRunner(command: string): GateTestRunner | null {
    return analyzeShellCommand(command).runner;
}

/** PURE: 대화 기록 → 증거. */
export function collectVerificationEvidence(conversation: readonly ChatMessage[]): VerificationEvidence {
    const calls = finishedToolCalls(conversation);
    // 호출을 하나도 읽지 못했으면(id 없는 호출만 있는 기록 등) 판단할 근거가 없다 — 검증하는 쪽으로.
    // 창 초과로 오래된 메시지가 인계 요약으로 바뀐 대화도 같다 — 정리된 구간에서 무엇을 바꿨는지 볼 수 없다.
    const compacted = conversation.some((m) => m.role === 'user' && typeof m.content === 'string' && isHandoffSummary(m.content));
    const ev: VerificationEvidence = { mutated: calls.length === 0 || compacted, freshPass: null };
    const mutate = (): void => { ev.mutated = true; ev.freshPass = null; };
    for (const c of calls) {
        const rule = FILE_MUTATING_CALLS[c.name];
        if (rule) {
            if (!c.failed && rule.values.includes(String(c.args[rule.arg]))) mutate();
        } else if (VERIFY_EVIDENCE.MUTATING_TOOLS.includes(c.name)) {
            mutate();
        } else if (c.name === 'bash') {
            const command = typeof c.args.command === 'string' ? c.args.command.trim() : '';
            const { kind, runner } = analyzeShellCommand(command);
            if (kind === 'mutate') mutate();
            else if (runner) ev.freshPass = !c.failed && exitedOk(c.result) ? { command, runner } : null;
        }
    }
    return ev;
}
