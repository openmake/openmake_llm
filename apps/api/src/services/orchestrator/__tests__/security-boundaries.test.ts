/** Codex 구조 검토(2026-09-12) 5건 회귀 — 서버 공용 키 정책·비용 주체 · 영상 보정 범위 · job 저장 보장 · 저장본 조회 분리 · 명시 모드 공통 경계 */
const mockConfig = { llmBaseUrl: 'http://127.0.0.1:13401/', llmApiKey: 'master', llmGatewayProviders: ['openrouter', 'hasa'] };
jest.mock('../../../config', () => ({ getConfig: () => mockConfig }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const budget = { reason: null as string | null, recorded: [] as Array<[string, number]> };
jest.mock('../../server-key-quota', () => ({
    checkServerKeyBudget: async (p: string, daily: number) => (daily <= 0 ? `서버 키 '${p}' 일 상한이 0 (잠금 상태)` : budget.reason),
    recordServerKeyUsage: async (p: string, t: number) => { budget.recorded.push([p, t]); },
}));
const serverUsage = jest.fn(async (_i: Record<string, unknown>) => undefined); const userUsage = jest.fn(async (_i: Record<string, unknown>) => undefined);
jest.mock('../../../data/repositories/server-external-keys-repo', () => ({ ServerExternalKeysRepository: class { recordUsage = serverUsage; } }));
jest.mock('../../../data/repositories/external-keys-repo', () => ({ ExternalKeysRepository: class { recordUsage = userUsage; } }));
jest.mock('../../../llm/user-quota', () => ({ checkUserQuota: async () => undefined, recordUserUsage: async () => undefined }));

import { resolveCapabilityTarget, clearGlobalCapabilityCache } from '../capability-resolver';
import { coerceJobFollowup, recordUsage } from '../orchestrate';
import type { CapabilityModelRow } from '../../../data/repositories/capability-models-repo';
import type { ValidatedPlan } from '../plan-schema';
import type { OrchestratorAttachment, TaskResult } from '../types';

const row = (scope: string, capability: CapabilityModelRow['capability'], fullId: string): CapabilityModelRow => ({ scope, capability, fullId, params: {}, updatedAt: new Date() });
function deps(o: { global?: CapabilityModelRow[]; server?: { isActive: boolean; dailyTokenLimit: number; monthlyTokenLimit: number | null; baseUrl?: string | null } | null; serverKey?: string | null }) {
    return {
        models: { get: async () => null, listGlobal: async () => o.global ?? [], insertIfAbsent: async () => true },
        userKeys: { decryptKey: async () => null, getByUserAndProvider: async () => null },
        serverKeys: { get: async () => o.server ?? null, decryptKey: async () => o.serverKey ?? null },
    } as never;
}
beforeEach(() => { clearGlobalCapabilityCache(); budget.reason = null; budget.recorded = []; serverUsage.mockClear(); userUsage.mockClear(); });

describe('1. 서버 공용 키 정책 — 역할 경로와 같은 검사', () => {
    const g = [row('__global__', 'audio.speech', 'openrouter:tts-x')];
    it('미등록·비활성·daily=0·상한 초과는 각각 실행 전 명시 실패', async () => {
        await expect(resolveCapabilityTarget('audio.speech', undefined, deps({ global: g, server: null }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_MISSING' });
        await expect(resolveCapabilityTarget('audio.speech', undefined, deps({ global: g, server: { isActive: false, dailyTokenLimit: 1000, monthlyTokenLimit: null }, serverKey: 's' }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_INACTIVE' });
        await expect(resolveCapabilityTarget('audio.speech', undefined, deps({ global: g, server: { isActive: true, dailyTokenLimit: 0, monthlyTokenLimit: null }, serverKey: 's' }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_BUDGET' });
        budget.reason = "서버 키 'openrouter' 일 토큰 상한 초과 (1000/1000)";
        await expect(resolveCapabilityTarget('audio.speech', undefined, deps({ global: g, server: { isActive: true, dailyTokenLimit: 1000, monthlyTokenLimit: null }, serverKey: 's' }))).rejects.toMatchObject({ code: 'CAPABILITY_KEY_BUDGET' });
    });
    it('정상 서버 키는 costOwner=server, 로컬은 local', async () => {
        const t = await resolveCapabilityTarget('audio.speech', undefined, deps({ global: g, server: { isActive: true, dailyTokenLimit: 1000, monthlyTokenLimit: null }, serverKey: 's' }));
        expect(t.costOwner).toBe('server'); expect(t.headers['x-api-key']).toBe('s');
        const l = await resolveCapabilityTarget('image.generate', undefined, deps({}));
        expect(l.costOwner).toBe('local');
    });
    it('사용량 계상은 비용 주체를 따른다 — server 는 server_external_key_usage+상한 카운터, user 는 external_provider_usage', () => {
        const res = (taskId: string, model: string): TaskResult => ({ taskId, capability: 'text.reason', ok: true, status: 'completed', text: '', media: [], ms: 1, model, usage: { promptTokens: 10, completionTokens: 5 } });
        const targets = new Map<string, { costOwner: 'server' | 'user' }>([['s', { costOwner: 'server' }], ['u', { costOwner: 'user' }]]);
        recordUsage('u1', [res('s', 'openrouter:m'), res('u', 'hasa:m')], targets as never);
        expect(serverUsage).toHaveBeenCalledTimes(1); expect(serverUsage.mock.calls[0][0]).toMatchObject({ providerId: 'openrouter', callerUserId: 'u1', inputTokens: 10, outputTokens: 5 });
        expect(budget.recorded).toEqual([['openrouter', 15]]);
        expect(userUsage).toHaveBeenCalledTimes(1); expect(userUsage.mock.calls[0][0]).toMatchObject({ providerId: 'hasa' });
    });
});

describe('2. 영상 보정 범위 — 결과 조회 의도 + 같은 대화만', () => {
    const simple = { complexity: 'simple', synthesis: false, tasks: [], levels: [] } as unknown as ValidatedPlan;
    const att = (same: boolean): Map<string, OrchestratorAttachment> => new Map([['j1', { id: 'j1', kind: 'job', name: 'n', mime: '', job: { capability: 'video.generate', providerId: 'hasa', jobId: 'vid_1', resultPath: '/generated/v.webm', sameConversation: same } }]]);
    it('설명 요청·새 생성 요청은 가로채지 않는다', () => {
        expect(coerceJobFollowup(simple, att(true), '영상 압축 원리를 설명해줘')).toBe(simple);
        expect(coerceJobFollowup(simple, att(true), '새로운 고양이 영상을 만들어줘')).toBe(simple);
        expect(coerceJobFollowup(simple, att(true), 'make me a new video of a cat')).toBe(simple);
    });
    it('결과 조회 의도라도 다른 대화의 job 은 대상이 아니다', () => {
        expect(coerceJobFollowup(simple, att(false), '아까 영상 다 됐어?')).toBe(simple);
        const p = coerceJobFollowup(simple, att(true), '아까 영상 다 됐어? 보여줘');
        expect(p.complexity).toBe('multi'); expect(p.tasks[0].attachments).toEqual(['j1']);
    });
});
