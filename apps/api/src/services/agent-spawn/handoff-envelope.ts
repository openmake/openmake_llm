/**
 * 핸드오프 봉투 — 서브에이전트(spawn_agents·delegate) 결과에 붙는 표준 계약 (하네스 v1.1 로드맵 P1 "핸드오프 계약 표준화").
 *
 * 종전 서브 결과는 평문 + 종료 사유 줄 + (선택) 형식 검증 판정이었다. 부모는 그 답이 실제 조회에서 나왔는지,
 * 어떤 정책 아래에서 돌았는지, 잘린 결과의 전문이 어디 있는지 알 수 없었다. 봉투는 그것을 결정적으로 모은다:
 *   - executionId  — 이 서브 실행을 가리키는 id(활동 기록의 trace_id#sub_index, 채팅은 임시 id)
 *   - evidence     — 서브가 **실제로** 부른 도구(성공·실패·거절 수)와 도구 결과에서 본 출처 URL. 모델의 자가 보고가 아니다.
 *   - result       — 부모에게 간 결과 전문의 sha256·글자 수(부모 쪽 예산 절단 뒤에도 전문을 가리키는 포인터)
 *   - policy       — 승인 정책·받은 도구 수·도구가 없던 사유
 *   - schema       — 형식 계약 판정(계약이 없으면 none)
 * 모델을 부르지 않는다(PURE). 수집기는 runSubagent 의 onToolOutcome 으로 채운다.
 *
 * @module services/agent-spawn/handoff-envelope
 */
import { createHash } from 'crypto';
import {
    AGENT_DELEGATION, HANDOFF_SOURCE_URL_RE, HANDOFF_URL_TRAILING_PUNCT_RE, type SubagentExitReason,
} from '../../config/agent-task-delegation';

/** 도구 호출 하나의 결과 — 실행해서 성공, 실행했지만 오류, 실행 전에 거절(승인 거절·자식 거절). */
export type HandoffToolOutcome = 'ok' | 'error' | 'denied';

export interface HandoffToolTally { tool: string; ok: number; error: number; denied: number }

export interface HandoffEnvelope {
    /** 봉투 형식 판 — 필드를 바꾸면 올린다(활동 기록의 옛 행과 구분). */
    v: 1;
    executionId: string;
    exit: SubagentExitReason | null;
    /** 끝난 결과를 재사용했다 — 이번 실행에서 도구를 부르지 않았으므로 evidence 는 비어 있다. */
    reused: boolean;
    evidence: { calls: number; tools: HandoffToolTally[]; sources: string[]; sourceCount: number };
    result: { sha256: string; chars: number };
    policy: { approvalPolicy: string; toolsGranted: number; noToolsReason?: string };
    schema: 'valid' | 'invalid' | 'none';
}

/** PURE: 텍스트에서 출처 URL 을 뽑는다 — 끝 문장 부호를 걷고 중복을 뺀다(나온 순서 유지). */
export function extractSourceUrls(text: string): string[] {
    const seen = new Set<string>();
    for (const m of text.matchAll(new RegExp(HANDOFF_SOURCE_URL_RE.source, HANDOFF_SOURCE_URL_RE.flags))) {
        const url = m[0].replace(HANDOFF_URL_TRAILING_PUNCT_RE, '');
        if (url) seen.add(url);
    }
    return [...seen];
}

/** 서브 실행 하나의 도구 결과 수집기 — runSubagent 의 onToolOutcome 에 record 를 넘긴다. */
export class HandoffEvidenceCollector {
    private readonly tallies = new Map<string, HandoffToolTally>();
    private readonly sources = new Set<string>();

    record = (tool: string, outcome: HandoffToolOutcome, resultText?: string): void => {
        let t = this.tallies.get(tool);
        if (!t) { t = { tool, ok: 0, error: 0, denied: 0 }; this.tallies.set(tool, t); }
        t[outcome] += 1;
        // 출처는 성공한 호출의 결과에서만 센다 — 오류 문구·거절 안내 속 URL 은 근거가 아니다.
        if (outcome === 'ok' && resultText) for (const url of extractSourceUrls(resultText)) this.sources.add(url);
    };

    snapshot(): HandoffEnvelope['evidence'] {
        const tools = [...this.tallies.values()];
        const all = [...this.sources];
        return {
            calls: tools.reduce((n, t) => n + t.ok + t.error + t.denied, 0),
            tools,
            sources: all.slice(0, AGENT_DELEGATION.HANDOFF_MAX_SOURCES),
            sourceCount: all.length,
        };
    }
}

/** PURE: 봉투 조립. 결과 전문은 해시와 길이만 싣는다(본문은 결과 자체와 활동 기록에 이미 있다). */
export function buildHandoffEnvelope(p: {
    executionId: string;
    exit: SubagentExitReason | undefined;
    reused: boolean;
    evidence: HandoffEnvelope['evidence'];
    result: string;
    approvalPolicy: string;
    toolsGranted: number;
    noToolsReason?: string;
    /** 형식 계약이 있으면 검사 결과(null = 통과), 없으면 undefined. */
    schemaProblem?: string | null;
}): HandoffEnvelope {
    return {
        v: 1,
        executionId: p.executionId,
        exit: p.exit ?? null,
        reused: p.reused,
        evidence: p.evidence,
        result: { sha256: createHash('sha256').update(p.result).digest('hex'), chars: p.result.length },
        policy: {
            approvalPolicy: p.approvalPolicy, toolsGranted: p.toolsGranted,
            ...(p.noToolsReason ? { noToolsReason: p.noToolsReason } : {}),
        },
        schema: p.schemaProblem === undefined ? 'none' : p.schemaProblem === null ? 'valid' : 'invalid',
    };
}

/** PURE: 빈 증거 — 재사용 결과·실행 전에 죽은 태스크용. */
export function emptyEvidence(): HandoffEnvelope['evidence'] {
    return { calls: 0, tools: [], sources: [], sourceCount: 0 };
}
