/**
 * GET /api/agents/skills/:skillId/export 소유권 가드 회귀 테스트 (2026-09-13 보안 점검 M1)
 * getSkillById 는 id 만으로 조회하므로 비공개 타인 스킬 본문이 id 만 알면 내려가던 갭.
 * 형제 라우트(PUT/DELETE/rewrite-proposal)와 같은 assertResourceOwnerOrAdmin 을 요구한다.
 */
jest.mock('../../agents/skill-manager', () => ({ getSkillManager: jest.fn() }));
jest.mock('../../auth', () => ({ requireAuth: (_r: unknown, _s: unknown, n: () => void) => n() }));
jest.mock('../../mcp/unified-client', () => ({ getUnifiedMCPClient: jest.fn() }));
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: jest.fn() }));

import skillsRouter from '../skills.routes';
import { getSkillManager } from '../../agents/skill-manager';

interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }
type Handler = (req: unknown, res: unknown, next: (e?: unknown) => void) => unknown;

function exportHandler(): Handler {
    const layers = (skillsRouter as unknown as { stack: Layer[] }).stack;
    const layer = layers.find((l) => l.route && l.route.path === '/:skillId/export' && l.route.methods.get);
    if (!layer?.route) throw new Error('route not found');
    return layer.route.stack[layer.route.stack.length - 1].handle as Handler;
}

function fakeRes() {
    const res: Record<string, unknown> & { statusCode?: number; body?: unknown; sent?: unknown } = {};
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    res.setHeader = () => res;
    res.send = (b: unknown) => { res.sent = b; return res; };
    return res;
}

async function run(skill: Record<string, unknown> | null, user: { id: string; role: string }) {
    (getSkillManager as jest.Mock).mockReturnValue({ getSkillById: jest.fn().mockResolvedValue(skill) });
    const res = fakeRes();
    let err: unknown;
    await new Promise<void>((resolve) => {
        exportHandler()({ params: { skillId: 's1' }, user }, res, (e) => { err = e; resolve(); });
        // asyncHandler 는 promise 를 기다리지 않고 반환하므로 send/next 중 먼저 오는 쪽을 기다린다
        const origSend = res.send as (b: unknown) => unknown;
        res.send = (b: unknown) => { origSend(b); resolve(); return res; };
    });
    return { res, err };
}

const base = { id: 's1', name: 'secret', description: 'd', category: 'c', content: 'PRIVATE-BODY' };

describe('스킬 export 소유권', () => {
    test('타인의 비공개 스킬은 거부된다', async () => {
        const { res, err } = await run({ ...base, createdBy: '7', isPublic: false }, { id: '3', role: 'user' });
        expect(res.sent).toBeUndefined();
        expect(err).toBeDefined();
    });
    test('본인 스킬은 내려간다', async () => {
        const { res, err } = await run({ ...base, createdBy: '3', isPublic: false }, { id: '3', role: 'user' });
        expect(err).toBeUndefined();
        expect(String(res.sent)).toContain('PRIVATE-BODY');
    });
    test('공개 스킬·시스템 스킬(createdBy 없음)은 누구나 내려받는다', async () => {
        const pub = await run({ ...base, createdBy: '7', isPublic: true }, { id: '3', role: 'user' });
        expect(pub.err).toBeUndefined();
        const sys = await run({ ...base, isPublic: false }, { id: '3', role: 'user' });
        expect(sys.err).toBeUndefined();
    });
    test('관리자는 타인 비공개 스킬도 내려받는다', async () => {
        const { err } = await run({ ...base, createdBy: '7', isPublic: false }, { id: '3', role: 'admin' });
        expect(err).toBeUndefined();
    });
});
