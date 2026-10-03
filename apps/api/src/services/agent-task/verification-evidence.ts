/**
 * 검증 증거 원장 — 대화 기록의 도구 호출에서 "파일을 바꿨는가"와 "그 뒤에 검증이 성공했는가"를 읽는다.
 *
 * 완료 관문의 테스트 게이트는 쓰기 도구 이름(bash 포함)만 보고 발동해, `ls` 만 한 작업도 테스트를 돌렸고
 * 모델이 방금 테스트를 돌려 통과했어도 같은 테스트를 한 번 더 돌렸다. 여기서는 호출을 순서대로 보며
 *   - 변경(편집 성공·코드 실행·읽기 전용이 아닌 셸 명령)이 나오면 앞선 검증 기록을 낡은 것으로 버리고,
 *   - 검증 명령이 종료 코드 0 으로 끝났으면 새 증거로 삼는다.
 * 애매하면 검증하는 쪽으로 기운다: 모르는 셸 명령은 변경, 종료 코드가 가려지는 명령(파이프·`|| true`)은 증거 아님,
 * 결과가 접혀 종료 코드 줄이 없으면 증거 아님, 기록에서 호출을 읽지 못하면 변경 있음.
 * 결정적 규칙이다(LLM 호출 없음). 발동 여부는 VERIFY_EVIDENCE.ENABLED(기본 꺼짐) — 호출부(finalize)가 본다.
 *
 * @module services/agent-task/verification-evidence
 */
import type { ChatMessage } from '../../llm/types';
import { FILE_MUTATING_CALLS, READ_ONLY_COMMAND_RES, VERIFY_COMMAND_RES, VERIFY_EVIDENCE } from '../../config/agent-task-tools';
import { finishedToolCalls } from './tool-call-history';

export interface VerificationEvidence {
    /** 파일을 바꿨을 수 있는 호출이 있었는가. */
    mutated: boolean;
    /** 마지막 변경 이후 성공한 검증 명령(가장 최근 것). 없으면 null. */
    freshPass: string | null;
}

type ShellKind = 'read' | 'verify' | 'mutate';

/** 셸 결과의 종료 줄 — 0 으로 끝났고 시간 초과가 아니다. */
const EXIT_OK_RE = /\[exit=0(?: TRUNCATED)? \d+ms\]/;

/** PURE: 셸 명령이 읽기만 하는지, 검증 증거가 되는지, 파일을 바꿨을 수 있는지. */
export function classifyShellCommand(command: string): ShellKind {
    // 따옴표 안은 비워 연산자·리다이렉션을 오인하지 않게 한다.
    const bare = command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/`|\$\(/.test(bare)) return 'mutate';
    // 파일로 내보내는 리다이렉션(> >>) — /dev/null 과 2>&1 은 뺀다.
    if (/>>?\s*(?!\s*(?:\/dev\/null|&\d))/.test(bare.replace(/\d*>&\d+/g, ''))) return 'mutate';
    const plain = bare.replace(/\d*>&\d+/g, ' ').replace(/\d*>>?\s*\/dev\/null/g, ' ');
    const parts = plain.split(/&&|\|\||[;|\n]/).map((p) => p.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')).filter((p) => p.length > 0);
    if (parts.length === 0) return 'read';
    let verify = false;
    for (const p of parts) {
        if (VERIFY_COMMAND_RES.some((re) => re.test(p))) verify = true;
        else if (!READ_ONLY_COMMAND_RES.some((re) => re.test(p))) return 'mutate';
    }
    // 검증 명령이 있어도 종료 코드가 그 명령의 것이라고 볼 수 없으면(파이프·;·||) 증거로 치지 않는다. && 는 전부 성공해야 0 이다.
    return verify && !/\|\||[;|\n]/.test(plain) ? 'verify' : 'read';
}

/** PURE: 대화 기록 → 증거. */
export function collectVerificationEvidence(conversation: readonly ChatMessage[]): VerificationEvidence {
    const calls = finishedToolCalls(conversation);
    // 호출을 하나도 읽지 못했으면(id 없는 호출만 있는 기록 등) 판단할 근거가 없다 — 검증하는 쪽으로.
    const ev: VerificationEvidence = { mutated: calls.length === 0, freshPass: null };
    const mutate = (): void => { ev.mutated = true; ev.freshPass = null; };
    for (const c of calls) {
        const rule = FILE_MUTATING_CALLS[c.name];
        if (rule) {
            if (!c.failed && rule.values.includes(String(c.args[rule.arg]))) mutate();
        } else if (VERIFY_EVIDENCE.MUTATING_TOOLS.includes(c.name)) {
            mutate();
        } else if (c.name === 'bash') {
            const command = typeof c.args.command === 'string' ? c.args.command.trim() : '';
            const kind = classifyShellCommand(command);
            if (kind === 'mutate') mutate();
            else if (kind === 'verify') ev.freshPass = !c.failed && EXIT_OK_RE.test(c.result) ? command : null;
        }
    }
    return ev;
}
