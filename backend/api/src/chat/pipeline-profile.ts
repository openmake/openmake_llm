/**
 * Pipeline Profile — 브랜드 모델 프로파일 정의
 * 
 * 외부 사용자가 요청하는 모델 별칭(openmake_llm, openmake_llm_pro 등)을
 * 내부 파이프라인 실행 전략으로 매핑합니다.
 * 
 * 각 프로파일은 10가지 파이프라인 요소를 조합하여
 * 모델 선택, 에이전트 사용, 사고 수준, 프롬프트 전략 등을 결정합니다.
 * 
 * @see docs/api/API_KEY_SERVICE_PLAN.md §9
 */

import { getConfig } from '../config/env';

// ============================================
// 파이프라인 프로파일 인터페이스
// ============================================

/** A2A (Agent-to-Agent) 사용 전략 */
export type A2AStrategy = 'off' | 'conditional' | 'always';

/** 사고(Thinking) 수준 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

/** 프롬프트 인젝션 전략 */
export type PromptStrategy = 'auto' | 'force_coder' | 'force_reasoning' | 'force_creative' | 'none';

/** 컨텍스트 윈도우 관리 전략 */
export type ContextStrategy = 'full' | 'lite' | 'auto';

/** 에이전트 루프 실행 방식 */
export type LoopStrategy = 'parallel' | 'sequential' | 'auto';

/**
 * 파이프라인 프로파일
 * 
 * 하나의 brand model alias에 대한 10가지 실행 전략을 정의합니다.
 */
export interface PipelineProfile {
    /** 프로파일 ID (brand model alias) */
    id: string;

    /** 표시 이름 */
    displayName: string;

    /** 설명 */
    description: string;

    // ─── 10가지 파이프라인 요소 ───

    /** 1. 내부 엔진 모델 ID (env에서 resolve) */
    engineModel: string;

    /** 2. A2A (Agent-to-Agent) 전략 */
    a2a: A2AStrategy;

    /** 3. 사고(Thinking) 수준 */
    thinking: ThinkingLevel;

    /** 4. 토론(Discussion) 활성화 여부 */
    discussion: boolean;

    /** 5. 프롬프트 인젝션 전략 */
    promptStrategy: PromptStrategy;

    /** 6. 에이전트 루프 최대 반복 횟수 */
    agentLoopMax: number;

    /** 7. 에이전트 루프 실행 방식 */
    loopStrategy: LoopStrategy;

    /** 8. 컨텍스트 윈도우 전략 */
    contextStrategy: ContextStrategy;

    /** 9. 시간 예산 (초) — 0이면 무제한 */
    timeBudgetSeconds: number;

    /** 10. 필수 도구 (없으면 빈 배열) */
    requiredTools: string[];
}

// ============================================
// 6개 브랜드 모델 프로파일 정의
// ============================================

/**
 * 프로파일 정의를 로드합니다.
 * env.ts 의 엔진 매핑 설정을 참조하여 런타임에 resolve합니다.
 */
export function getProfiles(): Record<string, PipelineProfile> {
    const config = getConfig();

    return {
        // ── 1. openmake_llm — Balanced General ──
        'openmake_llm': {
            id: 'openmake_llm',
            displayName: 'OpenMake LLM',
            description: '균형 잡힌 범용 모델 — 일반 대화, 콘텐츠 생성',
            engineModel: config.omkEngineLlm,
            a2a: 'conditional',
            thinking: 'medium',
            discussion: false,
            promptStrategy: 'auto',
            agentLoopMax: 5,
            loopStrategy: 'auto',
            contextStrategy: 'auto',
            timeBudgetSeconds: 0,
            requiredTools: [],
        },

        // ── 2. openmake_llm_pro — Premium Quality ──
        'openmake_llm_pro': {
            id: 'openmake_llm_pro',
            displayName: 'OpenMake LLM Pro',
            description: '프리미엄 품질 — 복잡한 지시, 창작, 분석',
            engineModel: config.omkEnginePro,
            a2a: 'always',
            thinking: 'high',
            discussion: true,
            promptStrategy: 'auto',
            agentLoopMax: 8,
            loopStrategy: 'auto',
            contextStrategy: 'full',
            timeBudgetSeconds: 0,
            requiredTools: [],
        },

        // ── 3. openmake_llm_fast — Speed Optimized ──
        'openmake_llm_fast': {
            id: 'openmake_llm_fast',
            displayName: 'OpenMake LLM Fast',
            description: '속도 최적화 — 실시간 대화, 단순 작업',
            engineModel: config.omkEngineFast,
            a2a: 'off',
            thinking: 'off',
            discussion: false,
            promptStrategy: 'none',
            agentLoopMax: 1,
            loopStrategy: 'sequential',
            contextStrategy: 'lite',
            timeBudgetSeconds: 3,
            requiredTools: [],
        },

        // ── 4. openmake_llm_think — Deep Reasoning ──
        'openmake_llm_think': {
            id: 'openmake_llm_think',
            displayName: 'OpenMake LLM Think',
            description: '심층 추론 — 수학, 논리, 복잡한 분석',
            engineModel: config.omkEngineThink,
            a2a: 'always',
            thinking: 'high',
            discussion: false,
            promptStrategy: 'force_reasoning',
            agentLoopMax: 10,
            loopStrategy: 'sequential',
            contextStrategy: 'full',
            timeBudgetSeconds: 0,
            requiredTools: [],
        },

        // ── 5. openmake_llm_code — Code Specialist ──
        'openmake_llm_code': {
            id: 'openmake_llm_code',
            displayName: 'OpenMake LLM Code',
            description: '코드 전문 — 프로그래밍, 디버깅, 리팩토링',
            engineModel: config.omkEngineCode,
            a2a: 'conditional',
            thinking: 'medium',
            discussion: false,
            promptStrategy: 'force_coder',
            agentLoopMax: 8,
            loopStrategy: 'auto',
            contextStrategy: 'full',
            timeBudgetSeconds: 0,
            requiredTools: [],
        },

        // ── 6. openmake_llm_vision — Multimodal / Vision ──
        'openmake_llm_vision': {
            id: 'openmake_llm_vision',
            displayName: 'OpenMake LLM Vision',
            description: '멀티모달 — 이미지 분석, OCR, 비전 작업',
            engineModel: config.omkEngineVision,
            a2a: 'conditional',
            thinking: 'medium',
            discussion: false,
            promptStrategy: 'auto',
            agentLoopMax: 3,
            loopStrategy: 'sequential',
            contextStrategy: 'auto',
            timeBudgetSeconds: 0,
            requiredTools: ['vision'],
        },
    };
}

/**
 * 사용 가능한 brand model alias 목록
 */
export function getBrandModelAliases(): string[] {
    return Object.keys(getProfiles());
}

/**
 * brand model alias가 유효한지 확인
 */
export function isValidBrandModel(model: string): boolean {
    return model in getProfiles();
}
