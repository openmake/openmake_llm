/**
 * 같은 deviceId 충돌 응답 (설계 2026-11-19 device-id-conflict §5.2) — registerChecked 가 'conflict' 면 error 프레임 뒤
 * close(1008, 'device_conflict'), bridge_ready·기기 대기 재개 없음. hello 의 instanceId 정리.
 */
import type { WebSocket } from 'ws';
import type { WSMessage } from '../ws-types';

const mockRegisterChecked = jest.fn(async (..._a: unknown[]): Promise<string> => 'ok');
const mockResumeDeviceWait = jest.fn(async (..._a: unknown[]) => 0);
jest.mock('../../services/agent-task/device-wait', () => ({ resumeDeviceWaitingTasks: (...a: unknown[]) => mockResumeDeviceWait(...a) }));
jest.mock('../../services/local-bridge/registry', () => ({
    normalizeCapabilities: jest.requireActual('../../services/local-bridge/registry').normalizeCapabilities,
    getLocalBridgeRegistry: () => ({
        registerChecked: (...a: unknown[]) => mockRegisterChecked(...a),
        getDeviceIdByWs: () => null,
    }),
}));
jest.mock('../../config/local-bridge', () => ({
    ...jest.requireActual('../../config/local-bridge'),
    LOCAL_BRIDGE: { ENABLED: true, MAX_DEVICES: 3 },
}));

import { handleBridgeMessage } from '../ws-bridge-handler';
import { BRIDGE_DEVICE_CONFLICT_MESSAGE } from '../../config/local-bridge';

function fakeWs() {
    const sent: Array<Record<string, unknown>> = [];
    const raw = {
        _authenticatedUserId: 'u-c', _apiKeyScopes: ['bridge'], readyState: 1, OPEN: 1,
        send: jest.fn((s: string) => { sent.push(JSON.parse(s) as Record<string, unknown>); }),
        close: jest.fn(),
    };
    return { ws: raw as unknown as WebSocket, raw, sent };
}
const hello = (extra: Record<string, unknown> = {}) => ({ type: 'bridge_hello', deviceId: 'dev-1', label: 'mac · w', folderName: 'w', ...extra }) as unknown as WSMessage;

beforeEach(() => { mockRegisterChecked.mockClear(); mockResumeDeviceWait.mockClear(); });

describe('handleBridgeMessage — 같은 기기 id 충돌', () => {
    it("'conflict' 면 error 프레임 뒤 1008 device_conflict 로 닫고 bridge_ready·재개가 없다", async () => {
        mockRegisterChecked.mockResolvedValueOnce('conflict');
        const { ws, raw, sent } = fakeWs();
        await handleBridgeMessage(ws, hello({ instanceId: 'i-1' }));
        await new Promise((r) => setImmediate(r));
        expect(sent).toEqual([{ type: 'error', message: BRIDGE_DEVICE_CONFLICT_MESSAGE }]);
        expect(raw.close).toHaveBeenCalledWith(1008, 'device_conflict');
        expect(mockResumeDeviceWait).not.toHaveBeenCalled();
    });

    it("'closed' 면 아무것도 보내지 않는다(새 소켓이 이미 닫혔다)", async () => {
        mockRegisterChecked.mockResolvedValueOnce('closed');
        const { ws, raw, sent } = fakeWs();
        await handleBridgeMessage(ws, hello());
        expect(sent).toEqual([]);
        expect(raw.close).not.toHaveBeenCalled();
    });

    it("'ok' 면 bridge_ready 를 보내고 기기 대기 작업을 재개한다", async () => {
        const { ws, sent } = fakeWs();
        await handleBridgeMessage(ws, hello());
        await new Promise((r) => setImmediate(r));
        expect(sent).toContainEqual({ type: 'bridge_ready', deviceId: 'dev-1' });
        expect(mockResumeDeviceWait).toHaveBeenCalledWith('u-c');
    });

    it('instanceId 는 64자 이하 문자열만 싣는다', async () => {
        const cases: Array<[unknown, string | undefined]> = [
            ['  i-1  ', 'i-1'], ['x'.repeat(64), 'x'.repeat(64)], ['x'.repeat(65), undefined], [42, undefined], ['', undefined], [undefined, undefined],
        ];
        for (const [raw, want] of cases) {
            mockRegisterChecked.mockClear();
            await handleBridgeMessage(fakeWs().ws, hello(raw === undefined ? {} : { instanceId: raw }));
            const s = mockRegisterChecked.mock.calls[0][0] as { instanceId?: string };
            expect(s.instanceId).toBe(want);
        }
    });
});
