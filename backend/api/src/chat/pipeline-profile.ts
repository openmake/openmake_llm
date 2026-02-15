/**
 * ============================================================
 * Pipeline Profile - 7개 브랜드 모델 파이프라인 프로파일 정의
 * ============================================================
 * 
 * 외부 사용자가 요청하는 모델 별칭(openmake_llm, openmake_llm_pro 등)을
 * 내부 파이프라인 실행 전략으로 매핑합니다.
 * 각 프로파일은 10가지 파이프라인 요소를 조합하여
 * 모델 선택, 에이전트 사용, 사고 수준, 프롬프트 전략 등을 결정합니다.
 * 
 * @module chat/pipeline-profile
 * @description
 * - 7개 브랜드 모델 프로파일 정의 (openmake_llm, _pro, _fast, _think, _code, _vision, _auto)
 * - 10가지 파이프라인 요소 (엔진, A2A, Thinking, Discussion, 프롬프트 전략 등) 조합
 * - env 설정 기반 런타임 엔진 모델 resolve
 * - ProfileResolver, ChatService 에서 소비
 * 
 * 프로파일 매핑 요약:
 * | Alias               | 엔진     | A2A         | Thinking | 용도                |
 * |---------------------|----------|-------------|----------|---------------------|
 * | openmake_llm        | LLM      | conditional | medium   | 균형 잡힌 범용       |
 * | openmake_llm_pro    | Pro      | always      | high     | 프리미엄 품질        |
 * | openmake_llm_fast   | Fast     | off         | off      | 속도 최적화          |
 * | openmake_llm_think  | Think    | always      | high     | 심층 추론            |
 * | openmake_llm_code   | Code     | conditional | medium   | 코드 전문            |
 * | openmake_llm_vision | Vision   | conditional | medium   | 멀티모달/비전        |
 * | openmake_llm_auto   | __auto__ | conditional | medium   | 스마트 자동 라우팅    |
 * 
 * @see docs/api/API_KEY_SERVICE_PLAN.md 9절
 * @see chat/profile-resolver.ts - 프로파일을 ExecutionPlan으로 변환
 * @see chat/model-selector.ts - auto 모드 시 질문 유형 기반 프로파일 선택
 */

import { getConfig } from '../config/env';

// ============================================
// 파이프라인 프로파일 인터페이스
// ============================================

/**
 * A2A (Agent-to-Agent) 사용 전략
 * - 'off': A2A 비활성화 (단일 모델 응답)
 * - 'conditional': 질문 복잡도에 따라 A2A 활성화
 * - 'always': 항상 다중 모델 병렬 생성 후 합성
 */
export type A2AStrategy = 'off' | 'conditional' | 'always';

/**
 * 사고(Thinking) 수준 - LLM의 내부 추론 깊이 제어
 * - 'off': 사고 과정 비활성화 (빠른 응답)
 * - 'low': 간단한 사고 과정
 * - 'medium': 중간 수준의 단계별 추론
 * - 'high': 심층적 Chain-of-Thought 추론
 */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

/**
 * 프롬프트 인젝션 전략 - 시스템 프롬프트에 주입할 역할 페르소나 결정
 * - 'auto': 질문 유형에 따라 자동 감지 (detectPromptType)
 * - 'force_coder': 코딩 전문가 프롬프트 강제 적용
 * - 'force_reasoning': 추론 전문가 프롬프트 강제 적용
 * - 'force_creative': 창작 전문가 프롬프트 강제 적용
 * - 'none': 프롬프트 인젝션 없음 (빠른 응답용)
 */
export type PromptStrategy = 'auto' | 'force_coder' | 'force_reasoning' | 'force_creative' | 'none';

/**
 * 컨텍스트 윈도우 관리 전략
 * - 'full': 전체 컨텍스트 사용 (65536 토큰)
 * - 'lite': 최소 컨텍스트 사용 (32768 토큰, 속도 우선)
 * - 'auto': 질문 길이에 따라 자동 결정
 */
export type ContextStrategy = 'full' | 'lite' | 'auto';

/**
 * 에이전트 루프 실행 방식
 * - 'parallel': 여러 도구를 병렬로 실행
 * - 'sequential': 도구를 순차적으로 실행
 * - 'auto': 도구 의존성에 따라 자동 결정
 */
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
 * 7개 브랜드 모델의 파이프라인 프로파일 정의를 로드합니다.
 * 
 * env.ts의 엔진 매핑 설정(OMK_ENGINE_*)을 참조하여 런타임에 실제 모델명을 resolve합니다.
 * '__auto__' 엔진은 ModelSelector가 질문 유형을 분석하여 동적으로 프로파일을 선택합니다.
 * 
 * @returns 브랜드 모델 alias를 키로 하는 PipelineProfile 딕셔너리
 * 
 * @example
 * const profiles = getProfiles();
 * const proProfile = profiles['openmake_llm_pro'];
 * console.log(proProfile.engineModel); // config.omkEnginePro 값
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

        // ── 7. openmake_llm_auto — Smart Auto-Routing ──
        'openmake_llm_auto': {
            id: 'openmake_llm_auto',
            displayName: 'OpenMake LLM Auto',
            description: '스마트 자동 라우팅 — 질문 유형에 따라 최적 모델 자동 선택 (코딩, 분석, 창작, 비전 등)',
            engineModel: '__auto__',
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
    };
}

/**
 * 사용 가능한 brand model alias 목록을 반환합니다.
 * 
 * @returns 브랜드 모델 alias 문자열 배열
 * @example
 * getBrandModelAliases(); // ['openmake_llm', 'openmake_llm_pro', ..., 'openmake_llm_auto']
 */
export function getBrandModelAliases(): string[] {
    return Object.keys(getProfiles());
}

/**
 * brand model alias가 유효한지 확인합니다.
 * 
 * @param model - 검증할 모델명 문자열
 * @returns 유효한 브랜드 모델이면 true, 아니면 false
 */
export function isValidBrandModel(model: string): boolean {
    return model in getProfiles();
}
