/**
 * 스킬 저장소 행 → 계약 DTO 변환 — 포트가 넘기는 값은 저장소 타입이 아니라 계약 DTO 다.
 */
import { toSkillRecordDTO } from '../../data/skill-record-dto';
import type { AgentSkill } from '../../data/skill-repository';

const skill = (over: Partial<AgentSkill> = {}): AgentSkill => ({
    id: 'sk1', name: '요약', description: '긴 글 요약', content: '# 요약', category: 'general', isPublic: true,
    createdAt: new Date('2026-10-16T01:02:03.000Z'), updatedAt: new Date('2026-10-16T04:05:06.000Z'),
    ...over,
});

describe('toSkillRecordDTO', () => {
    it('저장소 행을 직렬화 가능한 계약 DTO 로 바꾼다(시각은 ISO 문자열)', () => {
        expect(toSkillRecordDTO(skill({ createdBy: 'u1', status: 'active', sourcePath: 'system/x', extensionId: 'ext1' }))).toEqual({
            id: 'sk1', name: '요약', description: '긴 글 요약', content: '# 요약', category: 'general', isPublic: true,
            status: 'active', sourcePath: 'system/x', extensionId: 'ext1', createdBy: 'u1',
            createdAt: '2026-10-16T01:02:03.000Z', updatedAt: '2026-10-16T04:05:06.000Z',
        });
    });

    it('선택 필드가 없으면 null 로 채운다(undefined 를 싣지 않는다)', () => {
        const dto = toSkillRecordDTO(skill());
        expect(dto).toMatchObject({ status: null, sourcePath: null, extensionId: null, createdBy: null });
        expect(Object.values(dto)).not.toContain(undefined);
    });

    it('저장소 전용 필드(manifestMeta·sourceRepo·extensionName)는 계약에 싣지 않는다', () => {
        const dto = toSkillRecordDTO(skill({ manifestMeta: { a: 1 }, sourceRepo: 'git@example', extensionName: '확장' }));
        expect(dto).not.toHaveProperty('manifestMeta');
        expect(dto).not.toHaveProperty('sourceRepo');
        expect(dto).not.toHaveProperty('extensionName');
    });
});
