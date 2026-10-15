/**
 * 스킬 런타임 어댑터 — Base 포트에 저장소 행이 아니라 계약 DTO(SkillRecordDTO)를 넘긴다(시각은 ISO 문자열).
 */
jest.mock('../skill-manager', () => ({ getSkillManager: jest.fn() }));
jest.mock('../skill-catalog', () => ({ isSkillOfferEnabled: jest.fn(() => false) }));
jest.mock('../skill-catalog-tool', () => ({ applySkillCatalog: jest.fn() }));
jest.mock('../skill-usage-log', () => ({ recordSkillUsage: jest.fn() }));

import { getSkillManager } from '../skill-manager';
import { skillRuntime } from '../runtime';

describe('skillRuntime.getSkillsForAgent', () => {
    it('저장소 행을 SkillRecordDTO 로 바꿔 돌려준다', async () => {
        const getSkillsForAgent = jest.fn(async () => [{
            id: 'sk1', name: '요약', description: '', content: '# 요약', category: 'general', isPublic: true,
            createdAt: new Date('2026-10-16T01:00:00.000Z'), updatedAt: new Date('2026-10-16T02:00:00.000Z'),
            manifestMeta: { x: 1 },
        }]);
        (getSkillManager as jest.Mock).mockReturnValue({ getSkillsForAgent });

        await expect(skillRuntime.getSkillsForAgent('agent-1', 'u1', 'general')).resolves.toEqual([{
            id: 'sk1', name: '요약', description: '', content: '# 요약', category: 'general', isPublic: true,
            status: null, sourcePath: null, extensionId: null, createdBy: null,
            createdAt: '2026-10-16T01:00:00.000Z', updatedAt: '2026-10-16T02:00:00.000Z',
        }]);
        expect(getSkillsForAgent).toHaveBeenCalledWith('agent-1', 'u1', 'general');
    });
});
