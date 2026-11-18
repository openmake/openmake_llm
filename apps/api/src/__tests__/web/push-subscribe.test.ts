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
const { enablePushSubscription } = require('../../../../web/lib/push-subscribe') as {
    enablePushSubscription: (deps: Deps) => Promise<void>;
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
