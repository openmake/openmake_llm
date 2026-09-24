/**
 * 4. 저장본 조회는 현재 배정·키와 무관 — resolver 가 실패해도 파일이 있으면 preflight 가 거절하지 않는다(T15, Base 쪽).
 * 저장본을 실제로 돌려주는 실행은 video-runtime add-on 테스트가 검증한다.
 */
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => { throw new Error('no db'); } }));
jest.mock('../capability-resolver', () => ({
    ...jest.requireActual('../capability-resolver'),
    resolveCapabilityTarget: async () => { const { CapabilityUnavailableError } = jest.requireActual('../capability-resolver'); throw new CapabilityUnavailableError('키 없음', 'CAPABILITY_KEY_MISSING'); },
}));
jest.mock('../../../tools/generated-media', () => ({ resolveGeneratedPath: (p: string) => (p === '/generated/ok.webm' ? '/abs/ok.webm' : null) }));
jest.mock('../../../llm/user-quota', () => ({ checkUserQuota: async () => undefined, reserveUserQuota: async () => null, settleUserQuota: async () => undefined }));

import { preflightPlan } from '../preflight';
import { validatePlan } from '../plan-schema';
import type { ExecContext } from '../types';
import { registerMediaStubForTest } from './helpers/media-stub';
beforeAll(() => registerMediaStubForTest());

const ctx = (resultPath: string | null): ExecContext => ({ lang: 'ko', userMessage: 'q', results: new Map(), userId: 'u1', attachments: new Map([['j1', { id: 'j1', kind: 'job', name: 'n', mime: '', job: { capability: 'video.generate', providerId: 'hasa', jobId: 'vid_1', resultPath, sameConversation: true } }]]) } as unknown as ExecContext);
const plan = () => {
    const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'video.generate', input: { instruction: '보여줘', attachments: ['j1'] } }] }, new Set(['j1']));
    if (!v.ok) throw new Error(v.reason);
    return v.plan;
};

test('resolver 가 KEY_MISSING 이어도 저장본이 실재하면 preflight 는 승인한다(대상 해석 없음)', async () => {
    const pre = await preflightPlan(plan(), ctx('/generated/ok.webm'));
    expect(pre.rejected.size).toBe(0);
    expect(pre.handles.has('t1')).toBe(true);
    expect(pre.targets.has('t1')).toBe(false);
});

test('저장본 파일이 없으면 종전대로 키가 필요하다', async () => {
    const pre = await preflightPlan(plan(), ctx('/generated/gone.webm'));
    expect(pre.rejected.get('t1')).toMatch(/키 없음/);
});
