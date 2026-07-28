/**
 * profile-resolver.ts 단위 테스트
 * buildExecutionPlan, listAvailableModels 검증 (단일 로컬 모델 환경)
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

// getConfig mock
jest.mock('../config/env', () => ({
    getConfig: () => ({ llmDefaultModel: 'gemma4:e4b' }),
}));

import {
    buildExecutionPlan,
    listAvailableModels,
} from '../chat/profile-resolver';

// ===== buildExecutionPlan =====

describe('buildExecutionPlan', () => {
    test('항상 llmDefaultModel로 resolve', () => {
        const plan = buildExecutionPlan('some-model-id');
        expect(plan.resolvedEngine).toBe('gemma4:e4b');
    });

    test('profile=null', () => {
        const plan = buildExecutionPlan('any-model');
        expect(plan.profile).toBeNull();
    });

    test('executionStrategy=single', () => {
        const plan = buildExecutionPlan('some-model-id');
        expect(plan.executionStrategy).toBe('single');
    });

    test('requestedModel 보존', () => {
        const plan = buildExecutionPlan('some-model-id');
        expect(plan.requestedModel).toBe('some-model-id');
    });

    test('기본값 확인 — thinkingLevel, requiredTools, useDiscussion', () => {
        // Phase #I (2026-05-26): dead 필드 6개 제거됨 (useToolCalling, agentLoopMax,
        // loopStrategy, promptStrategy, contextStrategy, timeBudgetMs)
        const plan = buildExecutionPlan('any-model');
        expect(plan.thinkingLevel).toBe('medium');
        expect(plan.requiredTools).toEqual([]);
        expect(plan.useDiscussion).toBe(false);
    });
});

// ===== listAvailableModels =====

describe('listAvailableModels', () => {
    test('단일 로컬 모델 환경에서 llmDefaultModel 1개 반환', () => {
        const models = listAvailableModels();
        expect(models).toHaveLength(1);
        expect(models[0]).toMatchObject({
            id: expect.any(String),
            name: expect.any(String),
            description: expect.stringContaining('OpenMake'),
            capabilities: expect.arrayContaining(['chat', 'streaming']),
        });
    });
});
