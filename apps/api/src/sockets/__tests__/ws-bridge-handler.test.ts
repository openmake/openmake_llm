/**
 * 로컬 브리지 등록 게이트 — API key(bridge 스코프) 연결만 받는다 (2026-09-11).
 * JWT/쿠키 연결로 등록하던 것은 구 Electron 데스크톱 앱뿐이었고, macOS 는 네이티브 컴패니언만 지원한다.
 */
import type { WebSocket } from 'ws';
import type { WSMessage } from '../ws-types';

const mockRegister = jest.fn(() => true);
const mockHandleResult = jest.fn();
const mockSetControl = jest.fn();
const mockGetDeviceIdByWs = jest.fn((..._a: unknown[]): string | null => 'dev-1');
const mockResumeTakeover = jest.fn(async (..._a: unknown[]) => 0);
jest.mock('../../services/agent-task/browser-takeover', () => ({ resumeBrowserTakeoverTasks: (...a: unknown[]) => mockResumeTakeover(...a) }));

jest.mock('../../services/local-bridge/registry', () => ({
    normalizeCapabilities: jest.requireActual('../../services/local-bridge/registry').normalizeCapabilities,
    getLocalBridgeRegistry: () => ({
        register: (...a: unknown[]) => mockRegister(...(a as [])),
        handleResult: (...a: unknown[]) => mockHandleResult(...(a as [])),
        getDeviceIdByWs: (...a: unknown[]) => mockGetDeviceIdByWs(...a),
        setBrowserUserControl: (...a: unknown[]) => mockSetControl(...a),
    }),
}));
jest.mock('../../config/local-bridge', () => ({
    ...jest.requireActual('../../config/local-bridge'),
    LOCAL_BRIDGE: { ENABLED: true, MAX_DEVICES: 3 },
}));

import { handleBridgeMessage, closeExpiredBridge } from '../ws-bridge-handler';

function fakeWs(scopes: string[] | undefined) {
    const sent: Array<Record<string, unknown>> = [];
    const raw = {
        _authenticatedUserId: 'u3',
        _apiKeyScopes: scopes,
        send: jest.fn((s: string) => { sent.push(JSON.parse(s) as Record<string, unknown>); }),
        close: jest.fn(),
    };
    return { ws: raw as unknown as WebSocket, raw, sent };
}

const hello = { type: 'bridge_hello', deviceId: 'dev-1', label: 'mac · work', folderName: 'work' } as unknown as WSMessage;
const result = { type: 'bridge_result', reqId: 'r-1', result: { ok: true } } as unknown as WSMessage;

beforeEach(() => { mockRegister.mockClear(); mockHandleResult.mockClear(); });

describe('handleBridgeMessage — 연결 방식 게이트', () => {
    it('게스트 연결(비활성·삭제 계정의 키로 재연결)의 bridge_hello 는 등록하지 않는다', async () => {
        const { ws, raw, sent } = fakeWs(undefined);
        raw._authenticatedUserId = null as unknown as string;
        await handleBridgeMessage(ws, hello);
        expect(mockRegister).not.toHaveBeenCalled();
        expect(sent[0]).toMatchObject({ type: 'error' });
    });

    it('JWT/쿠키 연결(스코프 없음)의 bridge_hello 는 등록하지 않고 1008 로 닫는다', async () => {
        const { ws, raw, sent } = fakeWs(undefined);
        await handleBridgeMessage(ws, hello);
        expect(mockRegister).not.toHaveBeenCalled();
        expect(sent[0]).toMatchObject({ type: 'error' });
        expect(raw.close).toHaveBeenCalledWith(1008, 'bridge_api_key_required');
    });

    it('JWT/쿠키 연결의 bridge_result 도 받지 않는다', async () => {
        const { ws } = fakeWs(undefined);
        await handleBridgeMessage(ws, result);
        expect(mockHandleResult).not.toHaveBeenCalled();
    });

    it('bridge 스코프 API key 는 등록하고 bridge_ready 를 보낸다', async () => {
        const { ws, raw, sent } = fakeWs(['bridge']);
        await handleBridgeMessage(ws, hello);
        expect(mockRegister).toHaveBeenCalledTimes(1);
        expect(sent).toContainEqual({ type: 'bridge_ready', deviceId: 'dev-1' });
        expect(raw.close).not.toHaveBeenCalled();
    });

    it('전권(*) API key 도 등록한다', async () => {
        const { ws } = fakeWs(['*']);
        await handleBridgeMessage(ws, hello);
        expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    it('bridge 스코프가 없는 API key 는 bridge_scope_required 로 닫는다', async () => {
        const { ws, raw } = fakeWs(['chat']);
        await handleBridgeMessage(ws, hello);
        expect(mockRegister).not.toHaveBeenCalled();
        expect(raw.close).toHaveBeenCalledWith(1008, 'bridge_scope_required');
    });
});

describe('handleBridgeMessage — 능력 목록·PC 식별자', () => {
    const registered = (): Record<string, unknown> => (mockRegister.mock.calls[0] as unknown as [Record<string, unknown>])[0];

    it('hello 의 hostId·capabilities 를 정리해 등록에 넘긴다', async () => {
        const { ws } = fakeWs(['bridge']);
        await handleBridgeMessage(ws, { ...hello, hostId: '  mac-1  ', capabilities: ['read', 'exec', 'made_up'] } as unknown as WSMessage);
        expect(registered().hostId).toBe('mac-1');
        expect([...(registered().capabilities as Set<string>)].sort()).toEqual(['exec', 'read']);
    });

    it('보내지 않은 구버전은 둘 다 undefined 로 넘긴다 (레지스트리가 현행대로 처리)', async () => {
        const { ws } = fakeWs(['bridge']);
        await handleBridgeMessage(ws, hello);
        expect(registered().hostId).toBeUndefined();
        expect(registered().capabilities).toBeUndefined();
    });

    it('문자열이 아닌 hostId 는 버린다', async () => {
        const { ws } = fakeWs(['bridge']);
        await handleBridgeMessage(ws, { ...hello, hostId: { evil: true } } as unknown as WSMessage);
        expect(registered().hostId).toBeUndefined();
    });
});

describe('handleBridgeMessage — 키 id 기록 (키 폐기 시 연결 끊기용)', () => {
    it('API key 연결의 키 id 를 등록 세션에 싣는다', async () => {
        const { ws, raw } = fakeWs(['bridge']);
        (raw as Record<string, unknown>)._apiKeyId = 'key-123';
        await handleBridgeMessage(ws, hello);
        expect(mockRegister).toHaveBeenCalledWith(expect.objectContaining({ apiKeyId: 'key-123' }));
    });
});

describe('handleBridgeMessage — bridge_event(browser_control)', () => {
    beforeEach(() => { mockSetControl.mockClear(); mockResumeTakeover.mockClear(); });
    const ev = (user: unknown) => ({ type: 'bridge_event', kind: 'browser_control', user } as unknown as WSMessage);

    it('돌려주면(user=false) 상태를 기록하고 그 사용자의 넘겨받기 대기 작업 재개를 시도한다', async () => {
        const { ws, sent } = fakeWs(['bridge']);
        await handleBridgeMessage(ws, ev(false));
        await new Promise((r) => setImmediate(r));
        expect(mockSetControl).toHaveBeenCalledWith('u3', ws, false);
        expect(mockResumeTakeover).toHaveBeenCalledWith('u3');
        expect(sent).toEqual([]); // 단방향 — 응답하지 않는다
    });

    it('넘겨받으면(user=true) 상태만 기록한다', async () => {
        const { ws } = fakeWs(['bridge']);
        await handleBridgeMessage(ws, ev(true));
        await new Promise((r) => setImmediate(r));
        expect(mockSetControl).toHaveBeenCalledWith('u3', ws, true);
        expect(mockResumeTakeover).not.toHaveBeenCalled();
    });

    it('모르는 종류·불리언이 아닌 값은 무시한다', async () => {
        const { ws } = fakeWs(['bridge']);
        await handleBridgeMessage(ws, ev('no'));
        await handleBridgeMessage(ws, { type: 'bridge_event', kind: 'other', user: false } as unknown as WSMessage);
        expect(mockSetControl).not.toHaveBeenCalled();
        expect(mockResumeTakeover).not.toHaveBeenCalled();
    });
});

describe('handleBridgeMessage — 인증 실패 사유로 닫기 (2026-10-06)', () => {
    /** 사유를 알아듣는 새 코어의 hello — authClose 를 싣는다. */
    const newHello = { ...hello, authClose: true } as unknown as WSMessage;
    function guestWs(authFailure?: string) {
        const f = fakeWs(undefined);
        f.raw._authenticatedUserId = null as unknown as string;
        if (authFailure) (f.raw as Record<string, unknown>)._authFailure = authFailure;
        return f;
    }

    it.each([
        ['api_key_expired'], ['api_key_inactive'], ['api_key_invalid'], ['account_disabled'], ['account_deleted'],
    ])('게스트의 새 hello 는 인증 단계 사유(%s)로 1008 닫는다 — 등록하지 않는다', async (reason) => {
        const { ws, raw, sent } = guestWs(reason);
        await handleBridgeMessage(ws, newHello);
        expect(mockRegister).not.toHaveBeenCalled();
        expect(sent[0]).toMatchObject({ type: 'error' });
        expect(raw.close).toHaveBeenCalledWith(1008, reason);
    });

    it('사유가 없는 게스트(키 없이 접속)는 api_key_invalid 로 닫는다', async () => {
        const { ws, raw } = guestWs();
        await handleBridgeMessage(ws, newHello);
        expect(raw.close).toHaveBeenCalledWith(1008, 'api_key_invalid');
    });

    it('인증을 확인하지 못한 경우(DB 오류)는 다시 시도할 수 있는 1013 으로 닫는다', async () => {
        const { ws, raw } = guestWs('auth_unavailable');
        await handleBridgeMessage(ws, newHello);
        expect(raw.close).toHaveBeenCalledWith(1013, 'auth_unavailable');
    });

    it('authClose 를 싣지 않은 구버전 hello 는 종전대로 오류만 보내고 닫지 않는다 (구버전 앱의 재연결 반복 방지)', async () => {
        const { ws, raw, sent } = guestWs('api_key_expired');
        await handleBridgeMessage(ws, hello);
        expect(sent[0]).toMatchObject({ type: 'error' });
        expect(raw.close).not.toHaveBeenCalled();
    });
});

describe('closeExpiredBridge — 하트비트가 키 만료로 끊을 때', () => {
    beforeEach(() => { mockGetDeviceIdByWs.mockReset(); });

    it('등록된 브리지 연결이면 1008 api_key_expired 로 닫고 true', () => {
        mockGetDeviceIdByWs.mockReturnValue('dev-1');
        const { ws, raw } = fakeWs(['bridge']);
        expect(closeExpiredBridge(ws)).toBe(true);
        expect(raw.close).toHaveBeenCalledWith(1008, 'api_key_expired');
    });

    it('브리지가 아닌 연결은 건드리지 않고 false (호출부가 종전대로 terminate)', () => {
        mockGetDeviceIdByWs.mockReturnValue(null);
        const { ws, raw } = fakeWs(undefined);
        expect(closeExpiredBridge(ws)).toBe(false);
        expect(raw.close).not.toHaveBeenCalled();
    });

    it('게스트 연결도 false', () => {
        const { ws, raw } = fakeWs(undefined);
        raw._authenticatedUserId = null as unknown as string;
        expect(closeExpiredBridge(ws)).toBe(false);
        expect(mockGetDeviceIdByWs).not.toHaveBeenCalled();
    });
});
