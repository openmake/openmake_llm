/**
 * 웹 푸시 켜기(apps/web/lib/push-subscribe) — 서버 등록 실패 시 이번에 만든 브라우저 구독을 되돌리고 오류를 던진다.
 */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
interface Sub { endpoint: string; toJSON(): { keys?: Record<string, string> }; unsubscribe(): Promise<boolean> }
interface Deps {
    getSubscription: () => Promise<Sub | null>;
    createSubscription: () => Promise<Sub>;
    register: (body: { endpoint: string; keys?: Record<string, string> }) => Promise<unknown>;
}
const { enablePushSubscription, syncExistingPushSubscription, isPushRegistrationRejected } = require('../../../../web/lib/push-subscribe') as {
    enablePushSubscription: (deps: Deps) => Promise<void>;
    syncExistingPushSubscription: (deps: Pick<Deps, 'getSubscription' | 'register'>) => Promise<boolean>;
    isPushRegistrationRejected: (err: unknown) => boolean;
};

function makeSub(endpoint = 'https://jmt17.google.com/fcm/send/abc'): Sub & { unsubscribe: jest.Mock } {
    return { endpoint, toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: jest.fn().mockResolvedValue(true) };
}

describe('web push-subscribe enablePushSubscription', () => {
    it('구독이 없으면 새로 만들어 서버에 endpoint·keys 를 등록한다', async () => {
        const sub = makeSub();
        const register = jest.fn().mockResolvedValue({});
        await enablePushSubscription({ getSubscription: async () => null, createSubscription: async () => sub, register });
        expect(register).toHaveBeenCalledWith({ endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } });
        expect(sub.unsubscribe).not.toHaveBeenCalled();
    });

    it('새로 만든 구독의 서버 등록이 실패하면 구독을 해제하고 서버 오류를 그대로 던진다', async () => {
        const sub = makeSub();
        const err = new Error('허용되지 않는 push 서비스 호스트입니다');
        await expect(enablePushSubscription({
            getSubscription: async () => null,
            createSubscription: async () => sub,
            register: jest.fn().mockRejectedValue(err),
        })).rejects.toBe(err);
        expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('기존 구독이면 등록 실패해도 해제하지 않고 오류만 던진다', async () => {
        const sub = makeSub();
        const create = jest.fn();
        await expect(enablePushSubscription({
            getSubscription: async () => sub,
            createSubscription: create,
            register: jest.fn().mockRejectedValue(new Error('x')),
        })).rejects.toThrow('x');
        expect(create).not.toHaveBeenCalled();
        expect(sub.unsubscribe).not.toHaveBeenCalled();
    });

    it('되돌리기(unsubscribe)가 실패해도 원래 등록 오류를 던진다', async () => {
        const sub = makeSub();
        sub.unsubscribe.mockRejectedValue(new Error('unsub failed'));
        await expect(enablePushSubscription({
            getSubscription: async () => null,
            createSubscription: async () => sub,
            register: jest.fn().mockRejectedValue(new Error('register failed')),
        })).rejects.toThrow('register failed');
    });
});

describe('web push-subscribe syncExistingPushSubscription (설정 화면 진입 시 초기 상태)', () => {
    it('브라우저 구독이 없으면 등록하지 않고 false(꺼짐)', async () => {
        const register = jest.fn();
        await expect(syncExistingPushSubscription({ getSubscription: async () => null, register })).resolves.toBe(false);
        expect(register).not.toHaveBeenCalled();
    });

    it('브라우저 구독이 있으면 서버에 다시 등록하고 성공 시 true(켜짐)', async () => {
        const sub = makeSub();
        const register = jest.fn().mockResolvedValue({});
        await expect(syncExistingPushSubscription({ getSubscription: async () => sub, register })).resolves.toBe(true);
        expect(register).toHaveBeenCalledWith({ endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } });
    });

    it('재등록이 실패하면 서버 오류를 그대로 던지고 브라우저 구독은 해제하지 않는다', async () => {
        const sub = makeSub();
        const err = new Error('허용되지 않는 push 서비스 호스트입니다');
        await expect(syncExistingPushSubscription({
            getSubscription: async () => sub,
            register: jest.fn().mockRejectedValue(err),
        })).rejects.toBe(err);
        expect(sub.unsubscribe).not.toHaveBeenCalled();
    });
});

describe('web push-subscribe isPushRegistrationRejected (초기 재등록 실패 구분)', () => {
    const httpErr = (status: number) => Object.assign(new Error(`요청 실패 (${status})`), { name: 'ApiError', status });
    it.each([400, 422])('서버 검증 거부 %d 는 거부(꺼짐+오류 문구)', (status) => {
        expect(isPushRegistrationRejected(httpErr(status))).toBe(true);
    });
    it.each([401, 403, 404, 429, 500, 502, 503])('%d 는 일시 오류(켜짐 유지)', (status) => {
        expect(isPushRegistrationRejected(httpErr(status))).toBe(false);
    });
    it('status 없는 오류(네트워크 TypeError 등)·비 Error 값은 일시 오류', () => {
        expect(isPushRegistrationRejected(new TypeError('Failed to fetch'))).toBe(false);
        expect(isPushRegistrationRejected(undefined)).toBe(false);
        expect(isPushRegistrationRejected({ status: '400' })).toBe(false);
    });
});
