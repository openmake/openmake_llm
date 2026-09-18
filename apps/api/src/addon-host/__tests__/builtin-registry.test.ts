/**
 * 내장 팩 on/off — "팩 0개로도 Base 가 동작한다" 를 고정한다.
 */
const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

function withDisabled<T>(value: string | undefined, run: () => T): T {
    const before = process.env[ENV_KEY];
    if (value === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = value;
    try {
        let out!: T;
        jest.isolateModules(() => { out = run(); });
        return out;
    } finally {
        if (before === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = before;
    }
}

describe('builtin-registry', () => {
    it('기본은 전부 켜짐, env 에 적힌 id 만 꺼진다', () => {
        withDisabled(undefined, () => {
            const r = require('../builtin-registry');
            expect(r.isBuiltinAddonEnabled('industry-pack')).toBe(true);
            expect(r.isBuiltinAddonEnabled('utility-pack')).toBe(true);
        });
        withDisabled(' industry-pack , typo-pack', () => {
            const r = require('../builtin-registry');
            expect(r.isBuiltinAddonEnabled('industry-pack')).toBe(false);
            expect(r.isBuiltinAddonEnabled('utility-pack')).toBe(true);
            expect(r.unknownDisabledIds()).toEqual(['typo-pack']);
        });
    });

    it('보관 대상 source_path 패턴은 LIKE 패턴이며 Base 스킬 경로는 걸리지 않는다', () => {
        const r = require('../builtin-registry');
        const like = (pattern: string) => new RegExp('^' + pattern.split('%').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
        for (const pattern of Object.values(r.BUILTIN_ADDON_SKILL_SOURCE_PATH)) expect(pattern).toContain('%');
        const industry = like(r.BUILTIN_ADDON_SKILL_SOURCE_PATH['industry-pack']);
        expect(industry.test('agents/prompts/technology/software-engineer.md')).toBe(true);
        expect(industry.test('agents/prompts/general-agent.md')).toBe(false);
        expect(industry.test('agents/prompts/skill-author-system-prompt.ts')).toBe(false);
        expect(industry.test('skills/karpathy-guidelines/SKILL.md')).toBe(false);
    });
});

describe('팩 0개 배포', () => {
    it('산업 팩이 켜져 있으면 산업 에이전트가 로드된다(대조군)', () => {
        const agentIds = withDisabled(undefined, () => Object.keys(require('../../agents/agent-data').AGENTS));
        expect(agentIds.length).toBeGreaterThan(50);
    });

    it('산업 팩을 끄면 general 만 남고 라우터·LLM 라우터 후보가 비어도 동작한다', async () => {
        const mods = withDisabled('industry-pack,utility-pack', () => ({
            agentData: require('../../agents/agent-data'),
            llmRouter: require('../../agents/llm-router'),
            keywordRouter: require('../../agents/keyword-router'),
        }));
        expect(Object.keys(mods.agentData.AGENTS)).toEqual(['general']);
        expect(mods.llmRouter.getAgentSummaries()).toEqual([]);
        expect(mods.llmRouter.isValidAgentId('software-engineer')).toBe(false);
        const selection = await mods.keywordRouter.routeToAgent('React 컴포넌트 성능을 최적화하는 방법을 알려줘');
        expect(selection.primaryAgent).toBe('general');
    });
});
