/**
 * Model Pool 단위 테스트 — gitignored local 보관 (PR description inline).
 *
 * 5개 그룹:
 *   1. MODEL_POOL_CONFIG (env-driven)
 *   2. estimateTokens / estimateMessageTokens
 *   3. truncateMessagesPreservingSystem
 *   4. reduceToFit (단일 262K 안전망 3단계 점진차)
 *   5. selectModelByCapacity (Pure Manual / disabled / context-fit)
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    estimateTokens,
    estimateMessageTokens,
    truncateMessagesPreservingSystem,
    reduceToFit,
    selectModelByCapacity,
} from '../llm/model-pool';
import { ContextOverflowError } from '../errors/context-overflow.error';
import type { ChatMessage } from '../llm/types';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
    for (const k of Object.keys(process.env)) {
        if (k.startsWith('LLM_POOL_')) delete process.env[k];
    }
    process.env = { ...ORIGINAL_ENV };
});

describe('MODEL_POOL_CONFIG', () => {
    beforeEach(() => {
        for (const k of Object.keys(process.env)) {
            if (k.startsWith('LLM_POOL_')) delete process.env[k];
        }
    });

    it('default 값이 spec 과 일치', () => {
        jest.resetModules();
        const { MODEL_POOL_CONFIG } = require('../config/model-pool');
        expect(MODEL_POOL_CONFIG.enabled).toBe(true);
        expect(MODEL_POOL_CONFIG.defaultModel).toBe('qwen3.6-35b-a3b');
        expect(MODEL_POOL_CONFIG.defaultCtx).toBe(262144);
        expect(MODEL_POOL_CONFIG.routingMaxTokensDefault).toBe(16384);
        expect(MODEL_POOL_CONFIG.minOutputTokens).toBe(4096);
    });

    it('effective capacity 계산이 정확', () => {
        jest.resetModules();
        const { MODEL_POOL_CONFIG } = require('../config/model-pool');
        expect(MODEL_POOL_CONFIG.effectiveDefault).toBe(235929);  // 262144 * 0.90
    });

    it('env override 동작', () => {
        process.env.LLM_POOL_ENABLED = 'false';
        process.env.LLM_POOL_DEFAULT_MARGIN_PCT = '20';
        jest.resetModules();
        const { MODEL_POOL_CONFIG } = require('../config/model-pool');
        expect(MODEL_POOL_CONFIG.enabled).toBe(false);
        expect(MODEL_POOL_CONFIG.defaultMarginPct).toBe(20);
        expect(MODEL_POOL_CONFIG.effectiveDefault).toBe(209715);  // 262144 * 0.80
    });
});

describe('estimateTokens', () => {
    it('빈 string 은 0', () => {
        expect(estimateTokens('')).toBe(0);
    });

    it('영어 100 char (×0.25 ×1.05)', () => {
        // 100 * 0.25 = 25, * 1.05 = 26.25 → ceil 27
        expect(estimateTokens('a'.repeat(100))).toBe(27);
    });

    it('한글 100 자 (×1.0 ×1.05)', () => {
        // 100 * 1.05 → ceil 105
        expect(estimateTokens('가'.repeat(100))).toBe(105);
    });

    it('한자 100 자도 같은 비율', () => {
        expect(estimateTokens('中'.repeat(100))).toBe(105);
    });

    it('혼합 (한글 50 + 영어 50)', () => {
        // 50 + 12.5 = 62.5, * 1.05 = 65.625 → ceil 66
        expect(estimateTokens('가'.repeat(50) + 'a'.repeat(50))).toBe(66);
    });
});

describe('estimateMessageTokens', () => {
    it('빈 array 는 0', () => {
        expect(estimateMessageTokens([])).toBe(0);
    });

    it('각 message 별 +4 overhead', () => {
        const messages = [
            { role: 'system' as const, content: 'a'.repeat(100) },
            { role: 'user' as const, content: 'a'.repeat(100) },
        ];
        expect(estimateMessageTokens(messages)).toBe(27 + 4 + 27 + 4);
    });

    it('content 빈 문자열도 +4 overhead', () => {
        expect(estimateMessageTokens([{ role: 'system' as const, content: '' }])).toBe(4);
    });

    it('이미지는 장당 tokensPerImage 가산 (vision mis-routing 방지)', () => {
        const { MODEL_POOL_CONFIG } = require('../config/model-pool');
        const perImg = MODEL_POOL_CONFIG.tokensPerImage;
        const messages = [
            { role: 'user' as const, content: 'a'.repeat(100), images: ['b64a', 'b64b'] },
        ];
        // content(27) + 이미지 2장(2*perImg) + overhead(4)
        expect(estimateMessageTokens(messages)).toBe(27 + 2 * perImg + 4);
    });
});

describe('truncateMessagesPreservingSystem', () => {
    it('빈 array', () => {
        expect(truncateMessagesPreservingSystem([], 1000)).toEqual([]);
    });

    it('budget 충분하면 그대로', () => {
        const messages = [
            { role: 'system' as const, content: 'sys' },
            { role: 'user' as const, content: 'hello' },
        ];
        expect(truncateMessagesPreservingSystem(messages, 1000)).toHaveLength(2);
    });

    it('system 보존 + 가장 오래된 user/asst drop', () => {
        const messages = [
            { role: 'system' as const, content: '가'.repeat(100) },
            { role: 'user' as const, content: '가'.repeat(100) },
            { role: 'assistant' as const, content: '가'.repeat(100) },
            { role: 'user' as const, content: '가'.repeat(100) },  // 최근
        ];
        // budget = 250: system 109 + 최근 109 + ... = 첫 user 까지만 포함
        const result = truncateMessagesPreservingSystem(messages, 250);
        expect(result[0].role).toBe('system');
        expect(result[result.length - 1].content).toBe('가'.repeat(100));
        expect(result.length).toBeLessThan(messages.length);
    });

    it('최소 보장 — 부족해도 system + 최근 1 user 반환', () => {
        const messages = [
            { role: 'system' as const, content: '가'.repeat(500) },  // ~525
            { role: 'user' as const, content: '가'.repeat(500) },
        ];
        const result = truncateMessagesPreservingSystem(messages, 100);  // 매우 작음
        expect(result).toHaveLength(2);
    });
});

describe('truncateMessagesPreservingSystem — 앵커(첫 user=goal) 보호', () => {
    const sys = { role: 'system' as const, content: '가'.repeat(50) };
    const goal = { role: 'user' as const, content: '목표: 리포트를 만들어라' };
    const mid = (n: number) => Array.from({ length: n }, (_, i) => [
        { role: 'assistant' as const, content: `턴${i} ` + '나'.repeat(120) },
        { role: 'user' as const, content: `결과${i} ` + '다'.repeat(120) },
    ]).flat();

    it('오래된 턴을 버려도 앵커(goal)는 system 바로 뒤에 남는다', () => {
        const messages = [sys, goal, ...mid(6)];
        const full = estimateMessageTokens(messages);
        const result = truncateMessagesPreservingSystem(messages, Math.floor(full / 2));
        expect(result.length).toBeLessThan(messages.length);
        expect(result[0]).toBe(sys);
        expect(result[1]).toBe(goal);
        expect(result[result.length - 1]).toBe(messages[messages.length - 1]);
    });

    it('예산이 앵커+최근 1개도 못 담으면 종전대로 최근 것만 남긴다 (최소 보장 우선)', () => {
        const messages = [sys, goal, ...mid(2)];
        const last = messages[messages.length - 1];
        const result = truncateMessagesPreservingSystem(messages, estimateMessageTokens([sys, last]) + 1);
        expect(result[0]).toBe(sys);
        expect(result[result.length - 1]).toBe(last);
        expect(result).not.toContain(goal);
    });

    it('첫 메시지가 user 가 아니면(assistant 선두) 앵커 없음 — 종전 동작', () => {
        const lead = { role: 'assistant' as const, content: '선두' };
        const messages = [sys, lead, ...mid(3)];
        const result = truncateMessagesPreservingSystem(messages, estimateMessageTokens(messages) - 60);
        expect(result[0]).toBe(sys);
        expect(result).not.toContain(lead);
    });

    it('앵커 보호 후에도 선두 고아 tool 메시지는 제거된다', () => {
        const messages: ChatMessage[] = [sys, goal,
            { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: {} } }] },
            { role: 'tool' as const, content: '결과'.repeat(80), tool_call_id: 't1' },
            { role: 'assistant' as const, content: '마무리' },
        ];
        const budget = estimateMessageTokens([sys, goal, messages[4]]) + 5;
        const result = truncateMessagesPreservingSystem(messages, budget);
        expect(result[0]).toBe(sys); expect(result[1]).toBe(goal);
        expect(result.some((m) => m.role === 'tool')).toBe(false);
    });
});

describe('reduceToFit', () => {
    it('1단계 trigger — 오래된 메시지 drop 으로 262K 안에 맞춤', () => {
        const messages = [
            { role: 'system' as const, content: 'sys' },
            { role: 'user' as const, content: '가'.repeat(150_000) },   // ~157K tokens
            { role: 'user' as const, content: '가'.repeat(150_000) },   // ~157K tokens (최근 보존)
        ];
        const decision = reduceToFit(messages, { num_predict: 8192 });
        expect(decision.model).toBe('qwen3.6-35b-a3b');
        expect(decision.source).toBe('auto_trimmed');
        expect(decision.droppedMessages).toBeGreaterThan(0);
        expect(decision.adjustedMaxTokens).toBe(8192);
    });

    it('2단계 — input 못 줄이면 max_tokens 축소', () => {
        // 작은 input + 거대 num_predict → truncate 무효, 출력 토큰만 축소
        const messages = [{ role: 'user' as const, content: 'hi' }];
        const decision = reduceToFit(messages, { num_predict: 250_000 });
        expect(decision.model).toBe('qwen3.6-35b-a3b');
        expect(decision.source).toBe('auto_trimmed_reduced');
        expect(decision.adjustedMaxTokens).toBeLessThan(250_000);
        expect(decision.adjustedMaxTokens).toBeGreaterThanOrEqual(4096);
    });

    it('3단계 — 단일 메시지가 262K 초과 + 축소 불가 시 ContextOverflowError', () => {
        const messages = [
            { role: 'system' as const, content: '가'.repeat(300_000) },
        ];
        expect(() => reduceToFit(messages, { num_predict: 8192 }))
            .toThrow(ContextOverflowError);
    });
});

describe('selectModelByCapacity', () => {
    it('options.model 명시 → Pure Manual 우회', () => {
        const decision = selectModelByCapacity(
            [{ role: 'user' as const, content: 'hi' }],
            { model: 'gemma-4-31b', num_predict: 1000 },
        );
        expect(decision.model).toBe('gemma-4-31b');
        expect(decision.source).toBe('manual');
    });

    it('작은 input + 작은 max_tokens → default 모델 (그대로)', () => {
        const decision = selectModelByCapacity(
            [{ role: 'user' as const, content: 'hello' }],
            { num_predict: 1000 },
        );
        expect(decision.model).toBe('qwen3.6-35b-a3b');
        expect(decision.source).toBe('auto');
    });

    it('큰 input(trimmable) → default + truncate 안전망', () => {
        const decision = selectModelByCapacity(
            [
                { role: 'user' as const, content: '가'.repeat(150_000) },
                { role: 'user' as const, content: '가'.repeat(150_000) },
            ],
            { num_predict: 8192 },
        );
        expect(decision.model).toBe('qwen3.6-35b-a3b');
        expect(decision.source).toMatch(/auto_trimmed/);
    });

    it('input 작아도 num_predict 큰 경우 → max_tokens 축소', () => {
        const decision = selectModelByCapacity(
            [{ role: 'user' as const, content: 'hi' }],
            { num_predict: 250_000 },
        );
        expect(decision.model).toBe('qwen3.6-35b-a3b');
        expect(decision.source).toBe('auto_trimmed_reduced');
    });

    it('단일 메시지가 262K 초과 시 ContextOverflowError (1M 폐기 후)', () => {
        expect(() => selectModelByCapacity(
            [{ role: 'user' as const, content: '가'.repeat(300_000) }],
            { num_predict: 8192 },
        )).toThrow(ContextOverflowError);
    });
});

describe('truncateMessagesPreservingSystem — 고아 tool 페어 방어', () => {
    // 각 메시지: 영어 100자 = round(100*0.2625)=27, +4 overhead = 31 토큰.
    const msg = (role: 'system' | 'user' | 'assistant' | 'tool') => ({
        role, content: 'a'.repeat(100),
    });

    it('절단 경계가 assistant(tool_calls)를 잘라 kept 가 tool 로 시작하면 선두 고아 tool 제거', () => {
        const messages = [msg('system'), msg('assistant'), msg('tool'), msg('user')];
        // budget=100: system(31)+user(31)+tool(31)=93 유지, assistant 추가 시 124>100 → 잘림.
        // 그대로 두면 [system, tool, user] 로 tool 이 고아가 되어 provider 400.
        const result = truncateMessagesPreservingSystem(messages, 100);
        expect(result[0].role).toBe('system');
        // system 다음 첫 메시지가 tool 이어서는 안 된다(고아 제거됨).
        expect(result[1]?.role).not.toBe('tool');
        expect(result.some((m) => m.role === 'user')).toBe(true);
    });

    it('assistant→tool 페어가 온전히 남으면 tool 을 보존한다', () => {
        const messages = [msg('system'), msg('assistant'), msg('tool')];
        // budget 충분 → 전부 유지, tool 은 선두가 아니므로 제거 안 됨.
        const result = truncateMessagesPreservingSystem(messages, 1000);
        expect(result.map((m) => m.role)).toEqual(['system', 'assistant', 'tool']);
    });
});
