/**
 * Discord 봇 런타임 설정 배포 라우트 — 스코프 게이트와 배포 키 범위를 고정한다.
 * asyncHandler 는 promise 를 기다리지 않으므로 라우터 스택의 핸들러를 직접 호출한다.
 */
const getEffectiveValues = jest.fn();
const logAudit = jest.fn(async () => undefined);
jest.mock('../../services/system-settings-service', () => ({
    getSystemSettingsService: () => ({ getEffectiveValues }),
}));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));
// 라우터는 import 시점에 requireScope 를 호출하므로 호출 기록을 모듈 스코프에 남긴다
// (beforeEach 의 clearAllMocks 가 jest.fn 기록을 지워도 이 배열은 유지된다).
const mockScopeCalls: string[] = [];
jest.mock('../../middlewares/api-key-auth', () => ({
    requireApiKey: (_req: unknown, _res: unknown, next: () => void) => next(),
    requireScope: (scope: string) => { mockScopeCalls.push(scope); return (_req: unknown, _res: unknown, next: () => void) => next(); },
}));

import { discordRuntimeRouter } from '../discord-runtime.routes';
import { DISCORD_RUNTIME_SETTING_KEYS } from '../../config/discord-runtime';

function handler(path: string) {
    const layer = (discordRuntimeRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods.get);
    const h = layer.route.stack[layer.route.stack.length - 1].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any) => { h(req, res, jest.fn()); for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r)); };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /runtime-config', () => {
    it('discord 스코프를 요구한다', () => {
        expect(mockScopeCalls).toContain('discord');
    });

    it('유효 설정을 돌려주고 키 목록만 감사에 남긴다(값은 남기지 않음)', async () => {
        getEffectiveValues.mockReturnValue({ DISCORD_BOT_TOKEN: 'secret-token', DISCORD_REQUIRE_MENTION: 'true' });
        const res = mockRes();
        await handler('/runtime-config')({ user: { id: '3' }, ip: '127.0.0.1' }, res);
        expect(res.body.data.settings).toEqual({ DISCORD_BOT_TOKEN: 'secret-token', DISCORD_REQUIRE_MENTION: 'true' });
        expect(getEffectiveValues).toHaveBeenCalledWith(DISCORD_RUNTIME_SETTING_KEYS);
        const audited = (logAudit.mock.calls as unknown as Array<[{ details: { keys: string[] } }]>)[0][0];
        expect(audited.details.keys).toEqual(['DISCORD_BOT_TOKEN', 'DISCORD_REQUIRE_MENTION']);
        expect(JSON.stringify(audited)).not.toContain('secret-token');
    });

    it('배포 키 목록에 봇 API 키는 없다(부트스트랩 순환 차단)', () => {
        expect(DISCORD_RUNTIME_SETTING_KEYS).not.toContain('DISCORD_BOT_API_KEY' as never);
    });
});
