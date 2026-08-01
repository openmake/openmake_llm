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

    // ── 2026-08-01 벤치마크(32건 라벨셋) 회귀 케이스 ──
    // 초판 패턴이 놓쳤던 실제 어순(조사·중간 명사·표현 변형). 재현율 65%→100% 교정의 근거.
    it.each([
        '주 4일제 도입, 찬성과 반대 의견을 모두 들어보고 결론 내줘',
        '부동산 규제 강화가 효과적인지 다양한 관점으로 봐줘',
        '최저임금 인상의 장단점을 여러 시각에서 논의해줘',
        '원전 확대와 재생에너지 전환 중 어느 쪽이 나은지 알려줘',
    ])('토론 표현 변형 매칭: %s', (q) => {
        expect(detectOrchestrationIntents(q).discussion).toBe(true);
    });

    it.each([
        '국가별 인구 통계를 정리한 xlsx 파일을 만들어줘',
        '로그 파일을 파싱하는 스크립트를 만들어서 돌려줘',
        '텍스트 파일로 회의록 템플릿을 생성해줘',
        '이 데이터를 분석하는 파이썬 스크립트를 작성하고 실행해줘',
        '시간이 오래 걸려도 되니 전체 파일 목록을 정리해서 저장해줘',
    ])('위임 표현 변형 매칭: %s', (q) => {
        expect(detectOrchestrationIntents(q).taskDelegate).toBe(true);
    });

    // 오탐 0 유지 — 패턴을 넓혔어도 조회·설명 질의는 배제되어야 한다.
    it.each([
        '자바스크립트에서 배열을 정렬하는 방법 알려줘',
        '커피와 차의 카페인 함량 차이가 뭐야?',
        '어제 회의 내용 요약해줘',
        '파이썬 리스트 컴프리헨션 예시 보여줘',
        '깃 브랜치 전략 중 git flow가 뭐야?',
    ])('일반 질의는 미노출 유지: %s', (q) => {
        const r = detectOrchestrationIntents(q);
        expect(r.discussion || r.taskDelegate).toBe(false);
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
