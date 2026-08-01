/**
 * 오케스트레이션 자동 배정 (Stage 1) — 프리필터·도구 노출 게이트 단위 테스트.
 *
 * env 파생 상수(ORCHESTRATION_DISPATCH.ENABLED)는 requireActual+override mock 으로 고정
 * (프로젝트 관행 — env 의존 테스트 고정 패턴).
 */
jest.mock('../../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../../config/runtime-limits');
    return {
        ...actual,
        ORCHESTRATION_DISPATCH: { ...actual.ORCHESTRATION_DISPATCH, ENABLED: true },
    };
});

import { detectOrchestrationIntents, buildExternalToolPlan } from '../external-tool-plan';
import {
    START_DISCUSSION_TOOL_NAME,
    DELEGATE_AGENT_TASK_TOOL_NAME,
    isOrchestrationTool,
} from '../orchestration-dispatch';
import type { ChatMessageRequest } from '../../chat-service-types';

function makeReq(message: string): ChatMessageRequest {
    return { message } as ChatMessageRequest;
}

describe('detectOrchestrationIntents (프리필터)', () => {
    it('토론 의도 매칭 — "찬반 토론해줘"', () => {
        const r = detectOrchestrationIntents('원격근무 찬반 토론해줘');
        expect(r.discussion).toBe(true);
        expect(r.taskDelegate).toBe(false);
    });

    it('작업 위임 의도 매칭 — "엑셀로 만들어줘" / "백그라운드로"', () => {
        expect(detectOrchestrationIntents('이 데이터를 엑셀로 만들어줘').taskDelegate).toBe(true);
        expect(detectOrchestrationIntents('백그라운드 작업으로 처리해줘').taskDelegate).toBe(true);
    });

    it('단순 질문은 미매칭 — 오케스트레이션 도구 미노출 경로', () => {
        const r = detectOrchestrationIntents('오늘 날씨 어때?');
        expect(r.discussion).toBe(false);
        expect(r.taskDelegate).toBe(false);
    });

    it('보고서 단독 의도는 위임 미매칭 (P1 인라인 파이프라인과 충돌 방지)', () => {
        expect(detectOrchestrationIntents('시장 분석 보고서 작성해줘').taskDelegate).toBe(false);
    });
});

describe('buildExternalToolPlan (노출 게이트)', () => {
    const base = {
        allowedTools: [],
        toolCalling: true,
        wantsMap: false,
    };

    it('의도 매칭 시에만 오케스트레이션 도구 노출', () => {
        const plan = buildExternalToolPlan({
            ...base,
            req: makeReq('찬반 토론해줘'),
            orchestration: { discussion: true, taskDelegate: false },
        });
        const names = plan.tools.map((t) => t.function.name);
        expect(names).toContain(START_DISCUSSION_TOOL_NAME);
        expect(names).not.toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
    });

    it('의도 미매칭이면 미노출 (상시 노출 금지 — 도구폭주 방지)', () => {
        const plan = buildExternalToolPlan({
            ...base,
            req: makeReq('안녕'),
            orchestration: { discussion: false, taskDelegate: false },
        });
        const names = plan.tools.map((t) => t.function.name);
        expect(names).not.toContain(START_DISCUSSION_TOOL_NAME);
        expect(names).not.toContain(DELEGATE_AGENT_TASK_TOOL_NAME);
    });

    it('toolCalling=false 모델이면 의도가 있어도 미노출', () => {
        const plan = buildExternalToolPlan({
            ...base,
            toolCalling: false,
            req: makeReq('찬반 토론해줘'),
            orchestration: { discussion: true, taskDelegate: true },
        });
        expect(plan.tools).toHaveLength(0);
    });
});

describe('isOrchestrationTool', () => {
    it('두 도구 이름만 참', () => {
        expect(isOrchestrationTool(START_DISCUSSION_TOOL_NAME)).toBe(true);
        expect(isOrchestrationTool(DELEGATE_AGENT_TASK_TOOL_NAME)).toBe(true);
        expect(isOrchestrationTool('web_search')).toBe(false);
    });
});
