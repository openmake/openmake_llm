/**
 * 저장소 행 → 계약 DTO 변환 — 포트가 add-on·Base 사이에 넘기는 값은 저장소 타입이 아니라 계약 DTO 다.
 */
import { toAddonInstallationIntent, toSkillRecordDTO } from '../contract-mappers';
import type { AgentSkill } from '../../data/repositories/skill-repository';
import type { AddonInstallationRow } from '../../data/repositories/addon-state-repository';

const skill = (over: Partial<AgentSkill> = {}): AgentSkill => ({
    id: 'sk1', name: '요약', description: '긴 글 요약', content: '# 요약', category: 'general', isPublic: true,
    createdAt: new Date('2026-10-16T01:02:03.000Z'), updatedAt: new Date('2026-10-16T04:05:06.000Z'),
    ...over,
});

const row = (over: Partial<AddonInstallationRow> = {}): AddonInstallationRow => ({
    addon_id: 'a', name: 'A', version: '1.0.0', kind: 'content', source: 'builtin', state: 'enabled', desired_state: 'enabled',
    state_revision: 1, last_failure_code: null, failure_reason: null, entitlement_sku: null,
    installed_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z',
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

describe('toAddonInstallationIntent', () => {
    it('관리자 의도와 호환 상태만 옮긴다', () => {
        expect(toAddonInstallationIntent(row())).toEqual({ addonId: 'a', desiredState: 'enabled', state: 'enabled' });
    });

    it('부팅 실패(state=failed)여도 관리자 의도는 그대로다', () => {
        expect(toAddonInstallationIntent(row({ state: 'failed', desired_state: 'enabled', last_failure_code: 'runtime_failed' })))
            .toEqual({ addonId: 'a', desiredState: 'enabled', state: 'failed' });
    });

    it('관리자가 끈 add-on 은 desiredState disabled', () => {
        expect(toAddonInstallationIntent(row({ state: 'disabled', desired_state: 'disabled' })))
            .toEqual({ addonId: 'a', desiredState: 'disabled', state: 'disabled' });
    });
});
