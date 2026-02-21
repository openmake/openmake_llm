/**
 * ============================================================
 * Routing Logger Tests
 * ============================================================
 *
 * createRoutingLogEntry, logRoutingDecision, logA2AModelSelection 함수에 대한 단위 테스트입니다.
 * 기본값 생성, 부분 필드 병합, 로깅 함수 안전성을 검증합니다.
 *
 * @module __tests__/routing-logger
 */

import { describe, it, expect } from 'bun:test';
import {
    createRoutingLogEntry,
    logRoutingDecision,
    logA2AModelSelection,
    type RoutingDecisionLog,
} from '../chat/routing-logger';

// ============================================================
// 1. createRoutingLogEntry - Default Values
// ============================================================

describe('createRoutingLogEntry - defaults', () => {
    it('should return valid defaults with timestamp when called with empty object', () => {
        const entry: RoutingDecisionLog = createRoutingLogEntry({});

        expect(entry.timestamp).toBeDefined();
        expect(typeof entry.timestamp).toBe('string');
        // ISO 8601 format check
        expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);

        expect(entry.queryFeatures.queryType).toBe('unknown');
        expect(entry.queryFeatures.confidence).toBe(0);
        expect(entry.queryFeatures.hasImages).toBe(false);
        expect(entry.queryFeatures.queryLength).toBe(0);
        expect(entry.queryFeatures.isBrandModel).toBe(false);

        expect(entry.routeDecision.strategy).toBe('direct');
        expect(entry.modelUsed).toBe('unknown');
        expect(entry.latencyMs).toBe(0);
    });
});

// ============================================================
// 2. createRoutingLogEntry - Partial Field Merge
// ============================================================

describe('createRoutingLogEntry - partial fields', () => {
    it('should preserve provided modelUsed field', () => {
        const entry: RoutingDecisionLog = createRoutingLogEntry({ modelUsed: 'test-model' });
        expect(entry.modelUsed).toBe('test-model');
        // Other defaults should still be present
        expect(entry.queryFeatures.queryType).toBe('unknown');
        expect(entry.routeDecision.strategy).toBe('direct');
    });

    it('should merge partial queryFeatures correctly', () => {
        const entry: RoutingDecisionLog = createRoutingLogEntry({
            queryFeatures: {
                queryType: 'code',
                confidence: 0.95,
                hasImages: true,
                queryLength: 150,
                isBrandModel: true,
                brandProfile: 'openmake_llm_code',
            },
        });

        expect(entry.queryFeatures.queryType).toBe('code');
        expect(entry.queryFeatures.confidence).toBe(0.95);
        expect(entry.queryFeatures.hasImages).toBe(true);
        expect(entry.queryFeatures.queryLength).toBe(150);
        expect(entry.queryFeatures.isBrandModel).toBe(true);
        expect(entry.queryFeatures.brandProfile).toBe('openmake_llm_code');
    });

    it('should merge partial routeDecision correctly', () => {
        const entry: RoutingDecisionLog = createRoutingLogEntry({
            routeDecision: {
                strategy: 'a2a',
                a2aMode: 'always',
                primaryModel: 'model-a',
                secondaryModel: 'model-b',
                synthesizerModel: 'model-c',
            },
        });

        expect(entry.routeDecision.strategy).toBe('a2a');
        expect(entry.routeDecision.a2aMode).toBe('always');
        expect(entry.routeDecision.primaryModel).toBe('model-a');
        expect(entry.routeDecision.secondaryModel).toBe('model-b');
        expect(entry.routeDecision.synthesizerModel).toBe('model-c');
    });

    it('should preserve requestId and securityFlags when provided', () => {
        const entry: RoutingDecisionLog = createRoutingLogEntry({
            requestId: 'req-123',
            securityFlags: {
                preCheckPassed: true,
                postCheckPassed: false,
                violations: ['post:system_prompt_leak'],
            },
        });

        expect(entry.requestId).toBe('req-123');
        expect(entry.securityFlags?.preCheckPassed).toBe(true);
        expect(entry.securityFlags?.postCheckPassed).toBe(false);
        expect(entry.securityFlags?.violations).toContain('post:system_prompt_leak');
    });
});

// ============================================================
// 3. logRoutingDecision - Safety
// ============================================================

describe('logRoutingDecision', () => {
    it('should not throw when logging a valid entry', () => {
        const entry: RoutingDecisionLog = createRoutingLogEntry({
            modelUsed: 'gpt-oss:120b-cloud',
            latencyMs: 1234,
        });

        expect(() => logRoutingDecision(entry)).not.toThrow();
    });
});

// ============================================================
// 4. logA2AModelSelection - Safety
// ============================================================

describe('logA2AModelSelection', () => {
    it('should not throw when logging A2A model selection', () => {
        expect(() =>
            logA2AModelSelection('code', 'qwen3-coder-next:cloud', 'gpt-oss:120b-cloud', 'gemini-3-flash-preview:cloud')
        ).not.toThrow();
    });
});
