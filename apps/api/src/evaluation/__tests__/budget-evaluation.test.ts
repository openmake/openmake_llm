/**
 * 예산 게이트(F26.8) — 기준선 대비 증가율·절대 상한 판정과 컨텍스트 측정의 조립 동일성.
 */
import { compareBudget, renderBudgetTable, type BudgetMeasurement } from '../budget-evaluation';
import { BUDGET_CONTEXTS, measureContext, toolSchemaBytes } from '../budget-contexts';
import { buildExternalSystemPrompt, buildExternalSystemPromptParts } from '../../services/chat-service/external-system-prompt';

const base: BudgetMeasurement = { contexts: { a: { staticChars: 1000, fullChars: 1200 } }, alwaysOnToolSchemaBytes: 2000 };

describe('compareBudget', () => {
    it('허용 증가율 이내·감소는 통과, 초과는 실패', () => {
        expect(compareBudget({ contexts: { a: { staticChars: 1100, fullChars: 900 } }, alwaysOnToolSchemaBytes: 1500 }, base, { driftPct: 10 }).ok).toBe(true);
        const r = compareBudget({ contexts: { a: { staticChars: 1101, fullChars: 1200 } }, alwaysOnToolSchemaBytes: 2000 }, base, { driftPct: 10 });
        expect(r.ok).toBe(false);
        expect(r.rows.find((x) => x.metric === 'a.staticChars')!.reason).toContain('허용 10%');
    });

    it('절대 상한은 기준선과 무관하게 막는다', () => {
        const r = compareBudget(base, base, { driftPct: 10, maxStaticChars: 999, maxToolSchemaBytes: 5000 });
        expect(r.ok).toBe(false);
        expect(r.rows.find((x) => x.metric === 'a.staticChars')!.reason).toContain('절대 상한');
    });

    it('기준선에 없는 새 컨텍스트는 통과로 두되 표시한다', () => {
        const r = compareBudget({ contexts: { b: { staticChars: 99999, fullChars: 99999 } }, alwaysOnToolSchemaBytes: 2000 }, base, { driftPct: 10 });
        expect(r.ok).toBe(true);
        expect(renderBudgetTable(r.rows)).toContain('기준선 없음');
    });
});

describe('budget contexts', () => {
    it('정적+가변 조립은 운영 buildExternalSystemPrompt 와 바이트 단위로 같다', () => {
        const params = {
            req: { message: 'x', userLanguagePreference: 'ko' } as never,
            resolved: { fullId: 'm' } as never,
            ctx: { resolvedLanguage: 'ko', artifactGuideBlock: 'ART', agentSystemMessage: 'PERSONA', memoryBlock: 'MEM' } as never,
            wantsMap: true,
            wantsSpawn: true,
        };
        const { staticParts, dynamicParts } = buildExternalSystemPromptParts(params);
        expect([...staticParts, ...dynamicParts].join('\n\n')).toBe(buildExternalSystemPrompt(params));
        expect(staticParts.join('\n\n')).toContain('ART');
        expect(staticParts.join('\n\n')).not.toContain('PERSONA'); // 페르소나는 DYNAMIC BOUNDARY 뒤
    });

    it('페르소나·메모리는 정적 prefix 를 바꾸지 않는다(prefix cache 안정성)', () => {
        const baseKo = measureContext(BUDGET_CONTEXTS.find((c) => c.id === 'base-ko')!);
        const withMemory = measureContext(BUDGET_CONTEXTS.find((c) => c.id === 'agent-memory-ko')!);
        expect(withMemory.staticChars).toBe(baseKo.staticChars);
        expect(withMemory.fullChars).toBeGreaterThan(baseKo.fullChars);
    });

    it('도구 스키마 바이트는 UTF-8 기준', () => {
        expect(toolSchemaBytes([{ tool: { name: 't', description: '한글', inputSchema: {} } }])).toBe(Buffer.byteLength(JSON.stringify([{ type: 'function', function: { name: 't', description: '한글', parameters: {} } }]), 'utf8'));
    });
});
