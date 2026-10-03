/**
 * 절차 스킬 휴면 판정 — 연속 실패하거나 오래 쓰이지 않은 스킬을 이름 매칭 후보에서 뺀다(삭제하지 않는다).
 */
import { isProceduralDormant, dropDormantSkills, type SkillRunRow } from './procedural-dormancy';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-04T00:00:00Z');
const ago = (days: number): Date => new Date(now.getTime() - days * DAY);
const rule = { failStreak: 3, staleDays: 90 };

describe('isProceduralDormant', () => {
    it('최근 재생이 연속으로 실패하면 휴면', () => {
        expect(isProceduralDormant(ago(10), [{ status: 'error', ts: ago(1) }, { status: 'error', ts: ago(2) }, { status: 'error', ts: ago(3) }], now, rule)).toBe(true);
    });
    it('연속 실패 사이에 성공이 있으면 휴면이 아니다', () => {
        expect(isProceduralDormant(ago(10), [{ status: 'error', ts: ago(1) }, { status: 'ok', ts: ago(2) }, { status: 'error', ts: ago(3) }], now, rule)).toBe(false);
    });
    it('고쳐 쓴 뒤에는 그 전의 실패를 세지 않는다', () => {
        expect(isProceduralDormant(ago(1), [{ status: 'error', ts: ago(2) }, { status: 'error', ts: ago(3) }, { status: 'error', ts: ago(4) }], now, rule)).toBe(false);
    });
    it('저장·재생 모두 기준 일수보다 오래됐으면 휴면', () => {
        expect(isProceduralDormant(ago(200), [{ status: 'ok', ts: ago(120) }], now, rule)).toBe(true);
        expect(isProceduralDormant(ago(200), [], now, rule)).toBe(true);
    });
    it('오래 전에 저장했어도 최근에 재생했으면 휴면이 아니다', () => {
        expect(isProceduralDormant(ago(200), [{ status: 'ok', ts: ago(5) }], now, rule)).toBe(false);
    });
});

describe('dropDormantSkills', () => {
    const skills = [{ id: 'a', updatedAt: ago(10) }, { id: 'b', updatedAt: ago(10) }];
    const rows: SkillRunRow[] = ['1', '2', '3'].map((n) => ({ skillId: 'a', status: 'error' as const, ts: ago(Number(n)) }));

    it('휴면 스킬만 빼고 돌려준다', async () => {
        expect(await dropDormantSkills(skills, async () => rows, now)).toEqual([skills[1]]);
    });
    it('사용 기록 조회가 실패하면 전부 그대로 둔다', async () => {
        expect(await dropDormantSkills(skills, async () => { throw new Error('db'); }, now)).toEqual(skills);
    });
});
