/**
 * 작업용 모델의 내부 전용 (Companion P1-5) — 외부 제공자로 해석돼도 내부 모델을 쓴다.
 */
const resolveRoleClientForUser = jest.fn();
jest.mock('../../model-role-resolver', () => ({ resolveRoleClientForUser: (...a: unknown[]) => resolveRoleClientForUser(...a) }));
const createClient = jest.fn((o: { model: string }) => ({ model: o.model, local: true }));
jest.mock('../../../llm', () => ({ createClient: (o: { model: string }) => createClient(o) }));
jest.mock('../../../config/model-roles', () => ({ getModelForRole: (role: string) => `local-${role}-model` }));

import { initAgentRoleState, judgeClientFor } from '../role-client';

const external = { client: { model: 'gpt-x', local: false }, providerId: 'openai', fullId: 'openai:gpt-x' };
const local = { client: { model: 'qwen', local: true }, providerId: 'local-llm', fullId: 'local-llm:qwen' };

beforeEach(() => jest.clearAllMocks());

describe('initAgentRoleState — 내부 전용', () => {
    it('외부 제공자로 해석되면 쓰지 않고 내부 모델로 돌린다', async () => {
        resolveRoleClientForUser.mockResolvedValue(external);
        const s = await initAgentRoleState('t1', 'u1', undefined, { internalOnly: true });
        expect(s.external).toBe(false);
        expect(s.fallbackDone).toBe(true);
        expect(s.client).toMatchObject({ model: 'local-agent-model', local: true });
        expect(s.blockedExternal).toBe('openai:gpt-x');
    });

    it('내부 모델로 해석되면 그대로 쓴다', async () => {
        resolveRoleClientForUser.mockResolvedValue(local);
        const s = await initAgentRoleState('t1', 'u1', undefined, { internalOnly: true });
        expect(s.client).toBe(local.client);
        expect(s.blockedExternal).toBeUndefined();
        expect(createClient).not.toHaveBeenCalled();
    });

    it('내부 전용이 아니면 외부 모델을 그대로 쓴다(종전 동작)', async () => {
        resolveRoleClientForUser.mockResolvedValue(external);
        const s = await initAgentRoleState('t1', 'u1');
        expect(s.external).toBe(true);
        expect(s.client).toBe(external.client);
    });
});

describe('judgeClientFor — 내부 전용', () => {
    it('판정 모델도 외부로 해석되면 내부 모델을 쓴다', async () => {
        resolveRoleClientForUser.mockResolvedValue(external);
        await expect(judgeClientFor('u1', { internalOnly: true })).resolves.toMatchObject({ model: 'local-judge-model', local: true });
    });
    it('내부 전용이 아니면 해석 결과 그대로', async () => {
        resolveRoleClientForUser.mockResolvedValue(external);
        await expect(judgeClientFor('u1')).resolves.toBe(external.client);
    });
});
