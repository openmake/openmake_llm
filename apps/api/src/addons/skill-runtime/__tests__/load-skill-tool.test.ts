/**
 * load_skill 핸들러 — 찾으면 본문 반환 + called 기록, 못 찾으면 안내 + miss 기록.
 */
const buildMock = jest.fn();
jest.mock('../skill-manager', () => ({
    getSkillManager: () => ({ buildSkillPromptForNames: (...a: unknown[]) => buildMock(...a) }),
}));
const recordAutoSelectMock = jest.fn();
const recordUsageMock = jest.fn();
jest.mock('../skill-usage-log', () => ({
    recordSkillUsage: (...a: unknown[]) => recordUsageMock(...a),
    recordAutoSelect: (...a: unknown[]) => recordAutoSelectMock(...a),
}));

import { loadSkillTool } from '../load-skill-tool';
import type { UserContext } from '../../../tool-contract/types';

const ctx = { userId: 'u9' } as unknown as UserContext;

beforeEach(() => { buildMock.mockReset(); recordAutoSelectMock.mockReset(); recordUsageMock.mockReset(); });

describe('load_skill handler', () => {
    it('찾은 스킬 본문을 돌려주고 called(요청·매칭 수)와 스킬별 사용을 기록한다', async () => {
        buildMock.mockResolvedValue({ prompt: '# 보고서 지침', matched: ['보고서'], matchedIds: ['s-report'] });
        const res = await loadSkillTool.handler({ skill_names: ['보고서', '없는것'] }, ctx);
        expect(res.content[0]).toMatchObject({ text: '# 보고서 지침' });
        expect(recordAutoSelectMock).toHaveBeenCalledWith({ event: 'called', userId: 'u9', requested: 2, matched: 1 });
        expect(recordUsageMock.mock.calls[0][0][0]).toMatchObject({ skillId: 's-report', kind: 'load_skill', userId: 'u9' });
    });

    it('하나도 못 찾으면 안내 문구와 miss 를 기록한다', async () => {
        buildMock.mockResolvedValue({ prompt: '', matched: [], matchedIds: [] });
        const res = await loadSkillTool.handler({ skill_names: ['지어낸이름'] }, ctx);
        expect((res.content[0] as { text: string }).text).toContain('찾지 못했습니다');
        expect(recordAutoSelectMock).toHaveBeenCalledWith({ event: 'miss', userId: 'u9', requested: 1, matched: 0 });
        expect(recordUsageMock).not.toHaveBeenCalled();
    });

    it('이름이 없으면 아무것도 기록하지 않는다', async () => {
        await loadSkillTool.handler({ skill_names: [] }, ctx);
        expect(buildMock).not.toHaveBeenCalled();
        expect(recordAutoSelectMock).not.toHaveBeenCalled();
    });
});
