/**
 * 웹훅 트리거 라우트(132) — 실제 express 파서 순서(raw → json)로 원문 본문이 서명 검증에 닿는지,
 * 수신 응답 규칙(202·중복 200·401 일원화·발화 실패 422+실패 기록)과 관리 API(1회 시크릿·상한·템플릿·소유권)를 확인한다.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

const trig = {
    get: jest.fn(), getForVerification: jest.fn(), listByUser: jest.fn(async () => []), countByUser: jest.fn(async () => 0),
    create: jest.fn(async () => undefined), update: jest.fn(async () => undefined), rotateSecret: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined), claimDelivery: jest.fn(async () => true), recordFailure: jest.fn(async () => ({ disabled: false })),
};
jest.mock('../../data/repositories/agent-task-trigger-repository', () => ({ AgentTaskTriggerRepository: jest.fn().mockImplementation(() => trig) }));
const getTemplate = jest.fn();
jest.mock('../../data/repositories/agent-task-template-repository', () => ({ AgentTaskTemplateRepository: jest.fn().mockImplementation(() => ({ get: getTemplate })) }));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}), getUnifiedDatabase: () => ({}) }));
jest.mock('../../utils/token-crypto', () => ({ encryptToken: (s: string) => `enc:${s}`, decryptToken: (s: string) => s.replace(/^enc:/, ''), isDecryptionFailure: () => false }));
jest.mock('../../auth', () => ({ requireAuth: (req: Request, _res: Response, next: NextFunction) => { (req as any).user = { id: 'u1', role: 'user' }; next(); } }));
const fireTrigger = jest.fn();
const templateReadable = jest.fn(async () => true);
jest.mock('../../services/agent-task/trigger-service', () => {
    const actual = jest.requireActual('../../services/agent-task/trigger-service');
    return { ...actual, fireTrigger: (...a: unknown[]) => fireTrigger(...a), templateReadable: (...a: unknown[]) => templateReadable(...(a as [])) };
});
jest.mock('../../services/AgentTaskService', () => ({ AgentTaskService: jest.fn() }));
jest.mock('../../services/agent-task/task-queue', () => ({ dispatchAgentTask: jest.fn() }));
jest.mock('../../services/agent-task/boot-recovery', () => ({ resolveUserRole: jest.fn() }));

import { agentTaskTriggerRouter, triggerReceiverRouter } from '../agent-task-trigger.routes';
import { signTriggerPayload, TriggerFireError } from '../../services/agent-task/trigger-service';
import { TRIGGER_LIMITS } from '../../config/runtime-limits';

function app() {
    const a = express();
    a.use('/api/triggers', express.raw({ type: () => true, limit: TRIGGER_LIMITS.MAX_BODY_BYTES }));
    a.use('/api/', express.json({ limit: '1mb' }));
    a.use('/api/agent-task-triggers', agentTaskTriggerRouter);
    a.use('/api/triggers', triggerReceiverRouter);
    a.use((err: { statusCode?: number; code?: string; message: string }, _req: Request, res: Response, _next: NextFunction) => {
        res.status(err.statusCode ?? 500).json({ code: err.code, message: err.message });
    });
    return a;
}
const SECRET = 's3cret';
const stored = { id: 'tr1', user_id: 'u1', template_id: 'tp1', enabled: true, approval_policy: 'all', secret_encrypted: `enc:${SECRET}` };
const payload = JSON.stringify({ event: 'push', n: 1 });
function signed(body = payload, secret = SECRET) {
    const ts = String(Math.floor(Date.now() / 1000));
    return { ts, sig: signTriggerPayload(secret, ts, Buffer.from(body)) };
}

beforeEach(() => { jest.clearAllMocks(); trig.getForVerification.mockResolvedValue(stored); trig.claimDelivery.mockResolvedValue(true); });

describe('POST /api/triggers/:id (수신)', () => {
    it('JSON 본문도 원문 바이트로 서명 검증되어 202', async () => {
        fireTrigger.mockResolvedValue({ taskId: 'task-1', queued: false });
        const { ts, sig } = signed();
        const r = await request(app()).post('/api/triggers/tr1').set('Content-Type', 'application/json')
            .set('X-Openmake-Timestamp', ts).set('X-Openmake-Signature', sig).send(payload);
        expect(r.status).toBe(202);
        expect(r.body.data).toEqual({ taskId: 'task-1', queued: false });
        const [, rawBody] = fireTrigger.mock.calls[0] as [unknown, Buffer];
        expect(Buffer.isBuffer(rawBody) && rawBody.toString()).toBe(payload);
    });

    it('서명 불일치·없는 트리거·비활성은 모두 401 이고 발화하지 않는다', async () => {
        const { ts } = signed();
        const bad = signed(payload, 'wrong').sig;
        expect((await request(app()).post('/api/triggers/tr1').set('X-Openmake-Timestamp', ts).set('X-Openmake-Signature', bad).send(payload)).status).toBe(401);
        trig.getForVerification.mockResolvedValueOnce(undefined);
        expect((await request(app()).post('/api/triggers/nope').set('X-Openmake-Timestamp', ts).set('X-Openmake-Signature', signed().sig).send(payload)).status).toBe(401);
        trig.getForVerification.mockResolvedValueOnce({ ...stored, enabled: false });
        expect((await request(app()).post('/api/triggers/tr1').set('X-Openmake-Timestamp', ts).set('X-Openmake-Signature', signed().sig).send(payload)).status).toBe(401);
        expect(fireTrigger).not.toHaveBeenCalled();
        expect(trig.recordFailure).not.toHaveBeenCalled(); // 서명 실패는 연속 실패로 세지 않는다
    });

    it('같은 전달 id 재전송은 200 duplicate', async () => {
        trig.claimDelivery.mockResolvedValueOnce(false);
        const { ts, sig } = signed();
        const r = await request(app()).post('/api/triggers/tr1').set('X-Openmake-Timestamp', ts).set('X-Openmake-Signature', sig).set('X-Openmake-Delivery', 'd-1').send(payload);
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ duplicate: true, deliveryId: 'd-1' });
        expect(trig.claimDelivery).toHaveBeenCalledWith('tr1', 'd-1');
        expect(fireTrigger).not.toHaveBeenCalled();
    });

    it('발화 실패는 실패를 기록하고 422', async () => {
        fireTrigger.mockRejectedValue(new TriggerFireError('template_unavailable'));
        const { ts, sig } = signed();
        const r = await request(app()).post('/api/triggers/tr1').set('X-Openmake-Timestamp', ts).set('X-Openmake-Signature', sig).send(payload);
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('TRIGGER_FIRE_FAILED');
        expect(trig.recordFailure).toHaveBeenCalledWith('tr1', 'template_unavailable', TRIGGER_LIMITS.DISABLE_AFTER_FAILURES);
    });
});

describe('/api/agent-task-triggers (관리)', () => {
    it('생성은 시크릿을 1회 돌려주고 암호문만 저장한다', async () => {
        getTemplate.mockResolvedValue({ id: 'tp1', user_id: 'u1' });
        trig.get.mockResolvedValue({ id: 'x', name: 'n' });
        const r = await request(app()).post('/api/agent-task-triggers').send({ name: '배포 알림', templateId: 'tp1' });
        expect(r.status).toBe(201);
        const secret = r.body.data.secret as string;
        expect(secret.length).toBeGreaterThan(20);
        expect(trig.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', templateId: 'tp1', approvalPolicy: 'all', secretEncrypted: `enc:${secret}` }));
        expect(r.body.data.signing.endpoint).toMatch(/^\/api\/triggers\//);
        expect(JSON.stringify(r.body.data.trigger)).not.toContain(secret);
    });

    it('상한 초과·읽을 수 없는 템플릿·잘못된 정책은 400', async () => {
        trig.countByUser.mockResolvedValueOnce(TRIGGER_LIMITS.MAX_PER_USER);
        expect((await request(app()).post('/api/agent-task-triggers').send({ name: 'a', templateId: 'tp1' })).status).toBe(400);
        getTemplate.mockResolvedValueOnce({ id: 'tp1', user_id: 'u2' });
        templateReadable.mockResolvedValueOnce(false);
        expect((await request(app()).post('/api/agent-task-triggers').send({ name: 'a', templateId: 'tp1' })).status).toBe(400);
        expect((await request(app()).post('/api/agent-task-triggers').send({ name: 'a', templateId: 'tp1', approvalPolicy: 'auto' })).status).toBe(400);
        expect(trig.create).not.toHaveBeenCalled();
    });

    it('남의 트리거는 수정·재발급·삭제할 수 없다', async () => {
        trig.get.mockResolvedValue({ id: 'tr9', user_id: 'u2' });
        expect((await request(app()).patch('/api/agent-task-triggers/tr9').send({ enabled: false })).status).toBe(403);
        expect((await request(app()).post('/api/agent-task-triggers/tr9/rotate-secret')).status).toBe(403);
        expect((await request(app()).delete('/api/agent-task-triggers/tr9')).status).toBe(403);
        expect(trig.update).not.toHaveBeenCalled();
        expect(trig.rotateSecret).not.toHaveBeenCalled();
        expect(trig.delete).not.toHaveBeenCalled();
    });
});
