/**
 * /api/health 추가 절 — 이름으로 등록·해제, 실패·시간 초과는 그 절만 { error }, 예약 이름 거절, 같은 이름은 뒤의 것이 이긴다.
 */
import { collectHealthSections, registerHealthSection, resetHealthSectionsForTest } from '../health-sections';

afterEach(() => resetHealthSectionsForTest());

describe('health sections', () => {
    it('등록한 절을 이름으로 모으고, 해제하면 빠진다', async () => {
        const off = registerHealthSection('sample', async () => ({ ok: true }));
        await expect(collectHealthSections()).resolves.toEqual({ sample: { ok: true } });
        off();
        await expect(collectHealthSections()).resolves.toEqual({});
    });

    it('비동기 실패·동기 throw 는 그 절만 { error }', async () => {
        registerHealthSection('good', async () => 1);
        registerHealthSection('rejects', async () => { throw new Error('db down'); });
        registerHealthSection('throws', () => { throw new Error('sync boom'); });
        await expect(collectHealthSections()).resolves.toEqual({ good: 1, rejects: { error: 'db down' }, throws: { error: 'sync boom' } });
    });

    it('시간 상한을 넘으면 그 절만 { error: timeout }', async () => {
        registerHealthSection('slow', () => new Promise((r) => setTimeout(() => r('late'), 500)));
        registerHealthSection('fast', async () => 'ok');
        await expect(collectHealthSections(50)).resolves.toEqual({ slow: { error: 'timeout 50ms' }, fast: 'ok' });
    });

    it('응답의 기존 최상위 키는 절 이름으로 못 쓴다', () => {
        for (const name of ['status', 'timestamp', 'uptime', 'services']) {
            expect(() => registerHealthSection(name, async () => 1)).toThrow(`헬스 절 이름 '${name}' 은 예약돼 있다`);
        }
    });

    it('같은 이름을 다시 등록하면 뒤의 것이 이기고, 앞의 해제 함수는 뒤의 것을 지우지 않는다', async () => {
        const offOld = registerHealthSection('dup', async () => 'old');
        registerHealthSection('dup', async () => 'new');
        offOld();
        await expect(collectHealthSections()).resolves.toEqual({ dup: 'new' });
    });
});
