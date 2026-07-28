/**
 * skill-catalog-tool 단위 테스트 — load_skill 카탈로그 주입 규칙.
 *
 * 라이브 실측(2026-07-26): 에이전트 작업 경로에 카탈로그 주입이 없어 load_skill
 * 호출이 0건이었다. 채팅·에이전트 공용 SSoT 로 추출하면서 규칙을 고정한다.
 */
const buildSkillCatalogMock = jest.fn();
jest.mock('../../agents/skill-manager', () => ({
    getSkillManager: () => ({ buildSkillCatalog: buildSkillCatalogMock }),
}));

import { applySkillCatalog } from '../skill-catalog-tool';
import type { ToolDefinition } from '../../llm/types';

const loadSkillTool: ToolDefinition = {
    type: 'function',
    function: {
        name: 'load_skill',
        description: '스킬을 불러온다',
        parameters: { type: 'object', properties: {} },
    },
};
const otherTool: ToolDefinition = {
    type: 'function',
    function: { name: 'bash', description: '셸', parameters: { type: 'object', properties: {} } },
};

describe('applySkillCatalog', () => {
    const originalFlag = process.env.SKILL_AUTO_SELECT_ENABLED;

    beforeEach(() => {
        buildSkillCatalogMock.mockReset();
        process.env.SKILL_AUTO_SELECT_ENABLED = 'true';
    });
    afterAll(() => {
        if (originalFlag === undefined) delete process.env.SKILL_AUTO_SELECT_ENABLED;
        else process.env.SKILL_AUTO_SELECT_ENABLED = originalFlag;
    });

    it('카탈로그를 description 에 실어 load_skill 을 합류시킨다', async () => {
        buildSkillCatalogMock.mockResolvedValue({ catalog: '- 보고서: 보고서 작성', count: 1 });
        const out = await applySkillCatalog([otherTool], [otherTool, loadSkillTool]);

        const injected = out.find((t) => t.function.name === 'load_skill');
        expect(injected).toBeDefined();
        expect(injected!.function.description).toContain('## Skill Library (1)');
        expect(injected!.function.description).toContain('보고서 작성');
        // 파라미터 스키마는 원본 유지
        expect(injected!.function.parameters).toEqual(loadSkillTool.function.parameters);
    });

    it('플래그 OFF 면 load_skill 을 제거한다 (기능 OFF)', async () => {
        process.env.SKILL_AUTO_SELECT_ENABLED = 'false';
        const out = await applySkillCatalog([otherTool, loadSkillTool], [otherTool, loadSkillTool]);
        expect(out.some((t) => t.function.name === 'load_skill')).toBe(false);
        expect(buildSkillCatalogMock).not.toHaveBeenCalled();
    });

    it('카탈로그가 비면 제거한다 (빈 도구 노출 방지)', async () => {
        buildSkillCatalogMock.mockResolvedValue({ catalog: '', count: 0 });
        const out = await applySkillCatalog([otherTool, loadSkillTool], [otherTool, loadSkillTool]);
        expect(out.some((t) => t.function.name === 'load_skill')).toBe(false);
    });

    it('조회 실패는 graceful — 제거하고 흐름을 막지 않는다', async () => {
        buildSkillCatalogMock.mockRejectedValue(new Error('db down'));
        const out = await applySkillCatalog([otherTool, loadSkillTool], [otherTool, loadSkillTool]);
        expect(out).toEqual([otherTool]);
    });

    it('전체 카탈로그에 load_skill 이 없으면 노출하지 않는다', async () => {
        buildSkillCatalogMock.mockResolvedValue({ catalog: '- x: y', count: 1 });
        const out = await applySkillCatalog([otherTool], [otherTool]);
        expect(out).toEqual([otherTool]);
    });

    it('이미 주입된 스킬 id 는 excludeIds 로 전달된다 (중복 노출 방지)', async () => {
        buildSkillCatalogMock.mockResolvedValue({ catalog: '- a: b', count: 1 });
        const exclude = new Set(['skill-1']);
        await applySkillCatalog([otherTool], [otherTool, loadSkillTool], { excludeIds: exclude });
        expect(buildSkillCatalogMock).toHaveBeenCalledWith({ excludeIds: exclude });
    });

    it('중복 노출 방지 — 입력에 load_skill 이 있어도 결과는 1개', async () => {
        buildSkillCatalogMock.mockResolvedValue({ catalog: '- a: b', count: 1 });
        const out = await applySkillCatalog([otherTool, loadSkillTool], [otherTool, loadSkillTool]);
        expect(out.filter((t) => t.function.name === 'load_skill')).toHaveLength(1);
    });
});
