/** 4. 저장본 조회는 현재 배정·키와 무관 — resolver 가 실패해도 파일이 있으면 반환, preflight 도 통과 */
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => { throw new Error('no db'); } }));
jest.mock('../capability-resolver', () => ({
    ...jest.requireActual('../capability-resolver'),
    resolveCapabilityTarget: async () => { const { CapabilityUnavailableError } = jest.requireActual('../capability-resolver'); throw new CapabilityUnavailableError('키 없음', 'CAPABILITY_KEY_MISSING'); },
}));
jest.mock('../../../mcp/generated-media', () => ({ resolveGeneratedPath: (p: string) => (p === '/generated/ok.webm' ? '/abs/ok.webm' : null) }));
jest.mock('../../../llm/user-quota', () => ({ checkUserQuota: async () => undefined }));

import { videoGenerateExecutor } from '../executors/video';
import { preflightPlan } from '../preflight';
import { validatePlan } from '../plan-schema';
import type { ExecContext } from '../types';

const ctx = (): ExecContext => ({ lang: 'ko', userMessage: 'q', results: new Map(), userId: 'u1', attachments: new Map([['j1', { id: 'j1', kind: 'job', name: 'n', mime: '', job: { capability: 'video.generate', providerId: 'hasa', jobId: 'vid_1', resultPath: '/generated/ok.webm', sameConversation: true } }]]) } as unknown as ExecContext);

test('resolver 가 KEY_MISSING 이어도 저장본은 반환되고 preflight 도 거절하지 않는다', async () => {
    const v = validatePlan({ complexity: 'multi', tasks: [{ id: 't1', capability: 'video.generate', input: { instruction: '보여줘', attachments: ['j1'] } }] }, new Set(['j1']));
    if (!v.ok) throw new Error(v.reason);
    const pre = await preflightPlan(v.plan, ctx());
    expect(pre.rejected.size).toBe(0);
    const r = await videoGenerateExecutor(v.plan.tasks[0], ctx());
    expect(r.status).toBe('completed'); expect(r.media[0].urlPath).toBe('/generated/ok.webm');
});
