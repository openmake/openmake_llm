import { scheduleFireKey, isPreviousRunActive, isRetryFire } from './schedule-fire';

describe('scheduleFireKey — 발화마다 같은 키', () => {
    it('예약 id 와 예정 시각으로 만든다(문자열·Date 모두 같은 키)', () => {
        const a = scheduleFireKey('s1', '2026-10-04T00:00:00.000Z');
        expect(a).toBe(scheduleFireKey('s1', new Date('2026-10-04T00:00:00.000Z')));
        expect(a).not.toBe(scheduleFireKey('s1', '2026-10-04T00:05:00.000Z'));
        expect(a).not.toBe(scheduleFireKey('s2', '2026-10-04T00:00:00.000Z'));
    });
});

describe('isPreviousRunActive — 이전 실행이 아직 도는가', () => {
    const now = Date.parse('2026-10-04T01:00:00Z');
    const stale = 40 * 60_000;

    it('진행 중 상태이고 최근에 갱신됐으면 참', () => {
        for (const st of ['pending', 'queued', 'running', 'paused']) {
            expect(isPreviousRunActive({ status: st, updatedAt: new Date(now - 60_000) }, now, stale)).toBe(true);
        }
    });

    it('끝난 상태이거나 이전 실행이 없으면 거짓', () => {
        expect(isPreviousRunActive({ status: 'completed', updatedAt: new Date(now) }, now, stale)).toBe(false);
        expect(isPreviousRunActive({ status: 'failed', updatedAt: new Date(now) }, now, stale)).toBe(false);
        expect(isPreviousRunActive(null, now, stale)).toBe(false);
    });

    it('진행 중으로 남았어도 오래 갱신이 없으면(멈춘 표시) 거짓 — 예약이 영영 막히지 않게', () => {
        expect(isPreviousRunActive({ status: 'running', updatedAt: new Date(now - stale - 1) }, now, stale)).toBe(false);
    });
});

describe('isRetryFire', () => {
    const now = Date.parse('2026-10-04T01:00:00Z');
    it('재실행 시각이 지났고 정규 발화는 아직이면 재실행 발화다', () => {
        expect(isRetryFire({ retry_at: '2026-10-04T00:59:00Z', next_run_at: '2026-10-04T02:00:00Z' }, now)).toBe(true);
    });
    it('정규 발화 시각도 지났으면 정규 발화로 본다', () => {
        expect(isRetryFire({ retry_at: '2026-10-04T00:59:00Z', next_run_at: '2026-10-04T01:00:00Z' }, now)).toBe(false);
    });
    it('재실행 예정이 없으면 아니다', () => {
        expect(isRetryFire({ retry_at: null, next_run_at: '2026-10-04T01:00:00Z' }, now)).toBe(false);
    });
});
