/**
 * 로컬 브리지 등록 게이트 — API key(bridge 스코프) 연결만 받는다 (2026-09-11).
 * JWT/쿠키 연결로 등록하던 것은 구 Electron 데스크톱 앱뿐이었고, macOS 는 네이티브 컴패니언만 지원한다.
 */
import type { WebSocket } from 'ws';
import type { WSMessage } from '../ws-types';

const mockRegister = jest.fn(() => true);
const mockHandleResult = jest.fn();

jest.mock('../../services/local-bridge/registry', () => ({
    getLocalBridgeRegistry: () => ({
        register: (...a: unknown[]) => mockRegister(...(a as [])),
        handleResult: (...a: unknown[]) => mockHandleResult(...(a as [])),
        getDeviceIdByWs: () => 'dev-1',
    }),
}));
jest.mock('../../config/local-bridge', () => ({ LOCAL_BRIDGE: { ENABLED: true, MAX_DEVICES: 3 } }));

import { handleBridgeMessage } from '../ws-bridge-handler';

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
