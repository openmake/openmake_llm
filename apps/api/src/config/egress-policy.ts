/**
 * 데이터 반출 관문 (하네스 P0-2) — "이 요청의 자료를 OpenMake 밖(외부 모델·외부 도구·외부 검색)으로 보내도 되는가" 를
 * 한 곳에서 판정한다. 채팅·에이전트 작업(로컬 실행기·서버 샌드박스)이 모두 이 판정을 쓴다.
 *
 * 내부 전용(internalOnly)이 되는 경우:
 *   1. 로컬 실행기 작업 — 사용자 PC 의 파일·화면이 흘러간다(config/internal-only-policy, 종전 규칙 그대로).
 *   2. 민감도 기준 — 요청 본문·첨부의 민감도(config/data-sensitivity)가 EGRESS_INTERNAL_ONLY_SENSITIVITY 이상.
 *      기준값: off(기본 — 민감도로는 막지 않는다) · confidential · restricted.
 * 내부 전용이면 호출부가 외부 모델을 내부 모델로 바꾸고, 외부로 자료를 보내는 도구(위험 등급 network·external·외부 MCP)를
 * 목록에서 빼고, 사전 웹 검색·URL 사전 분석을 건너뛴다. 판정은 설정과 정규식뿐이다(A형 금지).
 *
 * @module config/egress-policy
 */
import { classifySensitivity, sensitivityAtLeast, type DataSensitivity } from './data-sensitivity';
import { isInternalOnlyRun, INTERNAL_ONLY } from './internal-only-policy';
import { classifyToolRisk, isThirdPartyTool } from './tool-policy';

export type EgressThreshold = 'off' | Exclude<DataSensitivity, 'normal'>;

function parseThreshold(raw: string | undefined): EgressThreshold {
    return raw === 'confidential' || raw === 'restricted' ? raw : 'off';
}

export const EGRESS_POLICY = {
    /** 이 민감도 이상이면 내부 전용. EGRESS_INTERNAL_ONLY_SENSITIVITY(off|confidential|restricted, 기본 off) */
    INTERNAL_ONLY_SENSITIVITY: parseThreshold(process.env.EGRESS_INTERNAL_ONLY_SENSITIVITY),
};

export type EgressReason = 'local_executor' | 'sensitivity';

export interface EgressDecision {
    internalOnly: boolean;
    /** 내부 전용이 된 이유 — internalOnly=false 면 null */
    reason: EgressReason | null;
    sensitivity: DataSensitivity;
    /** 걸린 민감도 패턴 이름(값 아님) */
    matched: string[];
}

export interface EgressInput {
    /** 에이전트 작업 실행기 — 'local' 이면 로컬 실행기 규칙 */
    executor?: string;
    /** 판정할 본문(사용자 메시지·작업 목표·첨부 추출 텍스트) */
    texts?: ReadonlyArray<string | undefined | null>;
}

/** PURE(설정 읽기): 반출 판정. threshold 는 테스트용(기본 설정값). */
export function decideEgress(input: EgressInput, threshold: EgressThreshold = EGRESS_POLICY.INTERNAL_ONLY_SENSITIVITY): EgressDecision {
    // 민감도는 기준이 꺼져 있어도 매긴다(관측·감사용) — 비용은 정규식 몇 개.
    const verdict = classifySensitivity(input.texts ?? []);
    if (isInternalOnlyRun({ executor: input.executor })) {
        return { internalOnly: true, reason: 'local_executor', sensitivity: verdict.level, matched: verdict.matched };
    }
    if (threshold !== 'off' && sensitivityAtLeast(verdict.level, threshold)) {
        return { internalOnly: true, reason: 'sensitivity', sensitivity: verdict.level, matched: verdict.matched };
    }
    return { internalOnly: false, reason: null, sensitivity: verdict.level, matched: verdict.matched };
}

/** PURE: 이 도구가 자료를 밖으로 보내는가 — 위험 등급 network·external 이거나 외부 MCP 서버 도구. */
export function sendsDataOutside(toolName: string, args: Record<string, unknown> = {}): boolean {
    const risk = classifyToolRisk(toolName, args);
    return risk === 'network' || risk === 'external' || isThirdPartyTool(toolName, args);
}

/** PURE: 내부 전용 문맥에서도 남기는(실행하는) 도구인가 — 허용 목록(LOCAL_EXECUTOR_INTERNAL_ONLY_TOOLS)이거나 자료를 밖으로 보내지 않는 도구. */
export function allowedWhenInternalOnly(toolName: string, args: Record<string, unknown> = {}): boolean {
    return INTERNAL_ONLY.ALLOWED_EXTRA_TOOLS.includes(toolName) || !sendsDataOutside(toolName, args);
}
