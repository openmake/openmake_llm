/**
 * 팩 검증 표시 — (팩, 모델) 최신 실행만 보고 하한으로 verified 를 가른다 (S3).
 */
import { groupPackVerifications } from '../pack-verification';

const row = (variant: string, model: string, pass_rate: number, total_cases = 6) =>
    ({ variant, model, pass_rate, total_cases, completed_at: '2026-09-20T04:00:00.000Z' });

describe('groupPackVerifications', () => {
    it('add-on id 별로 묶고 하한 미만은 verified=false, verified 가 먼저 온다', () => {
        const m = groupPackVerifications([row('addon:industry-pack', 'zeta', 0.5), row('addon:industry-pack', 'alpha', 1)], 0.8);
        expect(m.get('industry-pack')?.map((v) => `${v.model}:${v.verified}`)).toEqual(['alpha:true', 'zeta:false']);
    });

    it('팩 태그가 아닌 variant·케이스 0건 실행은 버린다 (0/0 을 검증됨으로 읽지 않는다)', () => {
        const m = groupPackVerifications([row('base', 'x', 1), row('addon:p', 'x', 0, 0)], 0.8);
        expect(m.size).toBe(0);
    });

    it('pg numeric 이 문자열로 와도 숫자로 비교한다', () => {
        const m = groupPackVerifications([{ ...row('addon:p', 'x', 0), pass_rate: '0.8333' as unknown as number }], 0.8);
        expect(m.get('p')?.[0]).toMatchObject({ verified: true, passRate: 0.8333 });
    });
});
