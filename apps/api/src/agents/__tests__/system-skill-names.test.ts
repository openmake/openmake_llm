/**
 * 시스템 시드 스킬·에이전트 영어 표시 이름 (2026-09-15).
 *
 * 배경: 에이전트·시드 스킬 이름이 한국어뿐이라 영문 UI 칩에 "범용 AI 어시스턴트" 등이 그대로 나왔다.
 */
import { AGENTS } from '../agent-data';
import { BUILTIN_ADDON_IDS } from '../../addon-host/builtin-registry';
import { loadPackSkills } from '../../addon-host/pack-skills';
import { GENERAL_SYSTEM_SKILL_NAME, systemSkillNamesEn } from '../system-skill-names';

const HANGUL = /\p{Script=Hangul}/u;

describe('시스템 스킬·에이전트 영어 표시 이름', () => {
    it('모든 에이전트와 팩 스킬에 한글 없는 영어 이름이 있다', () => {
        const missing = [
            ...Object.values(AGENTS).filter((a) => !a.nameEn || HANGUL.test(a.nameEn)).map((a) => a.id),
            ...BUILTIN_ADDON_IDS.flatMap((id) => loadPackSkills(id)).filter((s) => !s.nameEn || HANGUL.test(s.nameEn)).map((s) => s.id),
        ];
        expect(missing).toEqual([]);
    });

    it('산업·범용·유틸리티 시스템 스킬만 영어로 옮기고 사용자·확장 스킬은 넣지 않는다', () => {
        const names = ['소프트웨어 엔지니어 전문 스킬', GENERAL_SYSTEM_SKILL_NAME, '번역 전문가', 'karpathy-guidelines', '내가 만든 스킬'];

        expect(systemSkillNamesEn(names)).toEqual({
            '소프트웨어 엔지니어 전문 스킬': 'Software Engineer Skill',
            '범용 AI 어시스턴트 스킬': 'General AI Assistant Skill',
            '번역 전문가': 'Translation Expert',
        });
    });

    it('시스템 스킬이 하나도 없으면 undefined (이벤트 필드 생략)', () => {
        expect(systemSkillNamesEn(['karpathy-guidelines'])).toBeUndefined();
        expect(systemSkillNamesEn([])).toBeUndefined();
    });
});
