/**
 * profile-resolver.ts 단위 테스트
 * resolveProfile, buildExecutionPlan, listAvailableModels 검증
 */

// logger mock
jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

import {
    resolveProfile,
    buildExecutionPlan,
    listAvailableModels,
} from '../domains/chat/pipeline/profile-resolver';

const BRAND_MODELS = [
    'openmake_llm',
    'openmake_llm_pro',
    'openmake_llm_fast',
    'openmake_llm_think',
    'openmake_llm_code',
    'openmake_llm_vision',
    'openmake_llm_auto',
];

// ===== resolveProfile =====

describe('resolveProfile', () => {
    test.each(BRAND_MODELS)('브랜드 모델 %s → profile 반환', (model) => {
        const profile = resolveProfile(model);
        expect(profile).not.toBeNull();
        expect(profile?.id).toBe(model);
    });

    test('일반 모델 → null', () => {
        expect(resolveProfile('gpt-4')).toBeNull();
        expect(resolveProfile('llama3.2')).toBeNull();
        expect(resolveProfile('')).toBeNull();
    });

    test('openmake_llm_pro profile 필드 확인', () => {
        const profile = resolveProfile('openmake_llm_pro');
        expect(profile?.a2a).toBe('always');
        expect(profile?.thinking).toBe('high');
        expect(profile?.discussion).toBe(true);
    });

    test('openmake_llm_fast profile 필드 확인', () => {
        const profile = resolveProfile('openmake_llm_fast');
        expect(profile?.a2a).toBe('off');
        expect(profile?.thinking).toBe('off');
    });
});

// ===== buildExecutionPlan =====

describe('buildExecutionPlan', () => {
    describe('브랜드 모델 실행 계획', () => {
        test('openmake_llm → isBrandModel=true', () => {
            const plan = buildExecutionPlan('openmake_llm');
            expect(plan.isBrandModel).toBe(true);
        });

        test('openmake_llm_pro → profile에서 thinkingLevel, useDiscussion 설정됨', () => {
            const plan = buildExecutionPlan('openmake_llm_pro');
            expect(plan.thinkingLevel).toBe('high');
            expect(plan.useDiscussion).toBe(true);
            expect(plan.useAgentLoop).toBe(true); // always !== 'off'
        });

        test('openmake_llm_fast → useAgentLoop=false, thinkingLevel=off', () => {
            const plan = buildExecutionPlan('openmake_llm_fast');
            expect(plan.useAgentLoop).toBe(false); // a2a='off'
            expect(plan.thinkingLevel).toBe('off');
            expect(plan.useDiscussion).toBe(false);
        });

        test('openmake_llm_code → promptStrategy=force_coder', () => {
            const plan = buildExecutionPlan('openmake_llm_code');
            expect(plan.promptStrategy).toBe('force_coder');
        });

        test('openmake_llm_vision → requiredTools에 vision 포함', () => {
            const plan = buildExecutionPlan('openmake_llm_vision');
            expect(plan.requiredTools).toContain('vision');
        });

        test('openmake_llm_auto → resolvedEngine=__auto__', () => {
            const plan = buildExecutionPlan('openmake_llm_auto');
            expect(plan.resolvedEngine).toBe('__auto__');
        });

        test('timeBudgetMs = timeBudgetSeconds * 1000', () => {
            const plan = buildExecutionPlan('openmake_llm_fast');
            expect(plan.timeBudgetMs).toBe(3000); // fast=3초
        });

        test('requestedModel 보존', () => {
            const plan = buildExecutionPlan('openmake_llm_pro');
            expect(plan.requestedModel).toBe('openmake_llm_pro');
        });

        test('profile 객체 포함', () => {
            const plan = buildExecutionPlan('openmake_llm');
            expect(plan.profile).not.toBeNull();
            expect(plan.profile?.id).toBe('openmake_llm');
        });
    });

    describe('일반 모델 패스스루', () => {
        test('일반 모델 → isBrandModel=false', () => {
            const plan = buildExecutionPlan('llama3.2');
            expect(plan.isBrandModel).toBe(false);
        });

        test('일반 모델 → resolvedEngine=requestedModel', () => {
            const plan = buildExecutionPlan('qwen2.5:72b');
            expect(plan.resolvedEngine).toBe('qwen2.5:72b');
        });

        test('일반 모델 → profile=null', () => {
            const plan = buildExecutionPlan('gpt-4');
            expect(plan.profile).toBeNull();
        });

        test('일반 모델 → useAgentLoop=false (기본 패스스루)', () => {
            const plan = buildExecutionPlan('any-model');
            expect(plan.useAgentLoop).toBe(false);
            expect(plan.useDiscussion).toBe(false);
            expect(plan.timeBudgetMs).toBe(0);
            expect(plan.requiredTools).toEqual([]);
        });

        test('일반 모델 → thinkingLevel=medium (기본값)', () => {
            const plan = buildExecutionPlan('my-custom-model');
            expect(plan.thinkingLevel).toBe('medium');
        });
    });

    describe('a2a 전략 → useAgentLoop 변환', () => {
        test("a2a='conditional' → useAgentLoop=true", () => {
            // openmake_llm has a2a='conditional'
            const plan = buildExecutionPlan('openmake_llm');
            expect(plan.useAgentLoop).toBe(true);
        });

        test("a2a='always' → useAgentLoop=true", () => {
            const plan = buildExecutionPlan('openmake_llm_pro');
            expect(plan.useAgentLoop).toBe(true);
        });

        test("a2a='off' → useAgentLoop=false", () => {
            const plan = buildExecutionPlan('openmake_llm_fast');
            expect(plan.useAgentLoop).toBe(false);
        });
    });
});

// ===== listAvailableModels =====

describe('listAvailableModels', () => {
    test('7개 모델 반환', () => {
        const models = listAvailableModels();
        expect(models).toHaveLength(7);
    });

    test('각 모델에 id, name, description, capabilities 존재', () => {
        const models = listAvailableModels();
        models.forEach(model => {
            expect(model.id).toBeTruthy();
            expect(model.name).toBeTruthy();
            expect(model.description).toBeTruthy();
            expect(Array.isArray(model.capabilities)).toBe(true);
        });
    });

    test('pro 모델 capabilities에 agent, thinking, discussion 포함', () => {
        const models = listAvailableModels();
        const pro = models.find(m => m.id === 'openmake_llm_pro');
        expect(pro).toBeDefined();
        expect(pro?.capabilities).toContain('agent');
        expect(pro?.capabilities).toContain('thinking');
        expect(pro?.capabilities).toContain('discussion');
    });

    test('fast 모델 capabilities는 비어있거나 최소화', () => {
        const models = listAvailableModels();
        const fast = models.find(m => m.id === 'openmake_llm_fast');
        expect(fast).toBeDefined();
        // a2a='off', thinking='off', discussion=false → agent/thinking/discussion 없음
        expect(fast?.capabilities).not.toContain('agent');
        expect(fast?.capabilities).not.toContain('thinking');
        expect(fast?.capabilities).not.toContain('discussion');
    });

    test('vision 모델 capabilities에 vision 포함', () => {
        const models = listAvailableModels();
        const vision = models.find(m => m.id === 'openmake_llm_vision');
        expect(vision?.capabilities).toContain('vision');
    });

    test('id 목록이 getBrandModelAliases와 일치', () => {
        const models = listAvailableModels();
        const ids = models.map(m => m.id).sort();
        const expected = [
            'openmake_llm',
            'openmake_llm_pro',
            'openmake_llm_fast',
            'openmake_llm_think',
            'openmake_llm_code',
            'openmake_llm_vision',
            'openmake_llm_auto',
        ].sort();
        expect(ids).toEqual(expected);
    });
});
