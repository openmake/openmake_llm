/**
 * 웹훅 트리거(132) — 서명 검증(창·변조·형식), goal 구성(데이터 경계·자리·절단), 템플릿 접근, 발화(승인 하한·큐·기록).
 */
const createAgentTask = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ createAgentTask }), getPool: () => ({}) }));
const getTemplate = jest.fn();
jest.mock('../../../data/repositories/agent-task-template-repository', () => ({
    ...jest.requireActual('../../../data/repositories/agent-task-template-repository'),
    AgentTaskTemplateRepository: jest.fn().mockImplementation(() => ({ get: getTemplate })),
}));
const recordFired = jest.fn(async () => undefined);
jest.mock('../../../data/repositories/agent-task-trigger-repository', () => ({ AgentTaskTriggerRepository: jest.fn().mockImplementation(() => ({ recordFired })) }));
const membershipsFor = jest.fn(async (_u: string) => [] as Array<{ orgId: string }>);
jest.mock('../../org/membership-cache', () => ({ membershipsFor: (u: string) => membershipsFor(u) }));
let orgMin: string | undefined;
jest.mock('../../org/effective-policy', () => ({
    ...jest.requireActual('../../org/effective-policy'),
    resolveEffectivePolicy: async () => ({ approvalPolicyMin: orgMin }),
}));
const execute = jest.fn(async () => undefined);
jest.mock('../../AgentTaskService', () => ({ AgentTaskService: jest.fn().mockImplementation(() => ({ execute })) }));
const dispatchAgentTask = jest.fn(async (e: { run: () => Promise<void> }) => { await e.run(); return 'queued'; });
jest.mock('../task-queue', () => ({ dispatchAgentTask: (e: { run: () => Promise<void> }) => dispatchAgentTask(e) }));
jest.mock('../boot-recovery', () => ({ resolveUserRole: async () => 'user' }));

import {
    signTriggerPayload, verifyTriggerSignature, buildTriggerGoal, templateReadable, fireTrigger, TriggerFireError, generateTriggerSecret,
} from '../trigger-service';
import { TRIGGER_PAYLOAD_NOTICE } from '../../../prompts/agent-task-prompt';
import type { AgentTaskTrigger } from '../../../data/repositories/agent-task-trigger-repository';

const secret = 'test-secret';
const body = Buffer.from('{"event":"push","ref":"main"}');
const now = 1_800_000_000_000;
const ts = String(now / 1000);

beforeEach(() => { jest.clearAllMocks(); orgMin = undefined; });

describe('verifyTriggerSignature', () => {
    it('같은 규칙의 서명은 ok', () => {
        expect(verifyTriggerSignature({ secret, timestamp: ts, signature: signTriggerPayload(secret, ts, body), rawBody: body, nowMs: now })).toBe('ok');
    });
    it('창 밖 타임스탬프는 stale, 본문·시크릿·형식이 다르면 bad', () => {
        const old = String(now / 1000 - 301);
        expect(verifyTriggerSignature({ secret, timestamp: old, signature: signTriggerPayload(secret, old, body), rawBody: body, nowMs: now, windowSec: 300 })).toBe('stale');
        expect(verifyTriggerSignature({ secret, timestamp: ts, signature: signTriggerPayload(secret, ts, body), rawBody: Buffer.from('{"event":"x"}'), nowMs: now })).toBe('bad');
        expect(verifyTriggerSignature({ secret: 'other', timestamp: ts, signature: signTriggerPayload(secret, ts, body), rawBody: body, nowMs: now })).toBe('bad');
        expect(verifyTriggerSignature({ secret, timestamp: ts, signature: signTriggerPayload(secret, ts, body).replace('sha256=', ''), rawBody: body, nowMs: now })).toBe('bad');
        expect(verifyTriggerSignature({ secret, timestamp: undefined, signature: 'sha256=00', rawBody: body, nowMs: now })).toBe('bad');
        expect(verifyTriggerSignature({ secret, timestamp: '12.5', signature: 'sha256=00', rawBody: body, nowMs: now })).toBe('bad');
    });
    it('시크릿은 매번 다르고 URL 안전 문자만', () => {
        const a = generateTriggerSecret();
        expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
        expect(generateTriggerSecret()).not.toBe(a);
    });
});

describe('buildTriggerGoal', () => {
    it('{{payload}} 자리에 경계 태그로 넣고, JSON 은 들여쓴다', () => {
        const goal = buildTriggerGoal({ goal_template: '변경 요약:\n{{payload}}\n끝' }, body);
        expect(goal).toContain(`변경 요약:\n${TRIGGER_PAYLOAD_NOTICE}\n<webhook_payload>\n{\n  "event": "push"`);
        expect(goal.endsWith('</webhook_payload>\n끝')).toBe(true);
    });
    it('자리가 없으면 goal 끝에 붙이고, 템플릿 파라미터는 기본값으로 채운다', () => {
        const goal = buildTriggerGoal({ goal_template: '{{repo}} 점검', params: [{ name: 'repo', default: 'api' }] }, Buffer.from('plain text'));
        expect(goal.startsWith('api 점검\n\n')).toBe(true);
        expect(goal).toContain('<webhook_payload>\nplain text\n</webhook_payload>');
    });
    it('상한을 넘으면 페이로드만 잘라 상한 안에 맞춘다', () => {
        const goal = buildTriggerGoal({ goal_template: '요약' }, Buffer.from('x'.repeat(5000)), 1000);
        expect(goal.length).toBeLessThanOrEqual(1000);
        expect(goal).toContain('[페이로드가 길어 잘렸습니다]');
        expect(goal.startsWith('요약')).toBe(true);
    });
});

describe('templateReadable', () => {
    it('본인 소유 또는 소유자가 속한 조직 공유만', async () => {
        await expect(templateReadable({ user_id: 'u1' }, 'u1')).resolves.toBe(true);
        await expect(templateReadable({ user_id: 'u2', org_id: null }, 'u1')).resolves.toBe(false);
        membershipsFor.mockResolvedValueOnce([{ orgId: 'o1' }]);
        await expect(templateReadable({ user_id: 'u2', org_id: 'o1' }, 'u1')).resolves.toBe(true);
        membershipsFor.mockResolvedValueOnce([{ orgId: 'o2' }]);
        await expect(templateReadable({ user_id: 'u2', org_id: 'o1' }, 'u1')).resolves.toBe(false);
    });
});

describe('fireTrigger', () => {
    const trigger = { id: 'tr1', user_id: 'u1', template_id: 'tp1', approval_policy: 'none' } as AgentTaskTrigger;

    it('템플릿이 없거나 읽을 수 없으면 TriggerFireError(작업 생성 없음)', async () => {
        getTemplate.mockResolvedValueOnce(undefined);
        await expect(fireTrigger(trigger, body)).rejects.toBeInstanceOf(TriggerFireError);
        getTemplate.mockResolvedValueOnce({ user_id: 'u9', org_id: null, goal_template: 'x', max_turns: 5 });
        await expect(fireTrigger(trigger, body)).rejects.toBeInstanceOf(TriggerFireError);
        expect(createAgentTask).not.toHaveBeenCalled();
    });

    it('작업을 만들어 조직 승인 하한과 엄격한 쪽으로 큐에 넣고 발화를 기록한다', async () => {
        getTemplate.mockResolvedValue({ user_id: 'u1', goal_template: '처리: {{payload}}', max_turns: 7 });
        orgMin = 'high-risk';
        const r = await fireTrigger(trigger, body);
        expect(r.queued).toBe(true);
        expect(createAgentTask).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', maxTurns: 7, goal: expect.stringContaining('<webhook_payload>') }));
        expect(dispatchAgentTask).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', priority: 0 }));
        expect(execute).toHaveBeenCalledWith(expect.objectContaining({ approvalPolicy: 'high-risk', maxTurns: 7 }));
        expect(recordFired).toHaveBeenCalledWith('tr1', r.taskId);
    });
});
