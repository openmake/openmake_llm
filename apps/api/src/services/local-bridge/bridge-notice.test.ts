/**
 * 서버→디바이스 단방향 알림(bridge_notice) — 로컬 실행 작업의 승인 대기를 디바이스(컴패니언)로 알린다.
 * 고정 계약: ① 요청과 같은 라우팅(deviceId 지정 = 정확 일치, 미지정 = 최근 접속) ② 프레임은
 * 화이트리스트 필드만(임의 RPC 금지) ③ 디바이스 없음·닫힌 소켓·전송 예외는 조용히 false
 * ④ RemoteExecutor 는 자기 task·디바이스로 보낸다.
 */
import type { WebSocket } from 'ws';
import { getLocalBridgeRegistry, type BridgeNoticePayload, type DeviceSession } from './registry';
import { RemoteExecutor } from './remote-executor';

type FakeWs = WebSocket & { send: jest.Mock };

function fakeWs(open = true): FakeWs {
    return { readyState: open ? 1 : 3, OPEN: 1, send: jest.fn(), close: jest.fn() } as unknown as FakeWs;
}

function session(userId: string, deviceId: string, connectedAt: number, ws: WebSocket): DeviceSession {
    return { userId, deviceId, label: `dev-${deviceId}`, folderName: `f-${deviceId}`, ws, connectedAt };
}

const notice: BridgeNoticePayload = { notice: 'approval_pending', taskId: 'task-1234abcd', toolName: 'file_ops' };

describe('LocalBridgeRegistry.notify (bridge_notice)', () => {
    const reg = getLocalBridgeRegistry();
    const opened: WebSocket[] = [];

    afterEach(() => {
        for (const ws of opened.splice(0)) reg.unregister(ws);
    });

    function add(userId: string, deviceId: string, connectedAt: number, open = true): FakeWs {
        const ws = fakeWs(open);
        opened.push(ws);
        reg.register(session(userId, deviceId, connectedAt, ws));
        return ws;
    }

    it('지정한 디바이스에만, 화이트리스트 필드만 보낸다', () => {
        const a = add('u-n1', 'dev-a', 1);
        const b = add('u-n1', 'dev-b', 2);
        const withExtra = { ...notice, command: 'rm -rf /' } as unknown as BridgeNoticePayload;

        expect(reg.notify('u-n1', withExtra, 'dev-a')).toBe(true);

        expect(b.send).not.toHaveBeenCalled();
        expect(JSON.parse(a.send.mock.calls[0][0])).toEqual({
            type: 'bridge_notice', notice: 'approval_pending', taskId: 'task-1234abcd', toolName: 'file_ops',
        });
    });

    it('deviceId 미지정은 최근 접속 디바이스로 보낸다 — request() 와 같은 라우팅', () => {
        const a = add('u-n2', 'dev-a', 1);
        const b = add('u-n2', 'dev-b', 5);

        reg.notify('u-n2', { ...notice, toolName: 'ask_human' });

        expect(a.send).not.toHaveBeenCalled();
        expect(b.send).toHaveBeenCalledTimes(1);
    });

    it('디바이스 없음·닫힌 소켓·전송 예외는 false 이고 throw 하지 않는다', () => {
        expect(reg.notify('u-none', notice)).toBe(false);

        add('u-n3', 'dev-closed', 1, false);
        expect(reg.notify('u-n3', notice)).toBe(false);

        const c = add('u-n4', 'dev-throw', 1);
        c.send.mockImplementation(() => { throw new Error('boom'); });
        expect(reg.notify('u-n4', notice)).toBe(false);
    });
});

describe('RemoteExecutor.notifyApprovalPending', () => {
    afterEach(() => jest.restoreAllMocks());

    it('자기 task·디바이스로 approval_pending 알림을 보낸다', () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'notify').mockReturnValue(true);

        new RemoteExecutor('task-5678efgh', 'user-9', 'dev-z').notifyApprovalPending('file_ops');

        expect(spy).toHaveBeenCalledWith('user-9', { notice: 'approval_pending', taskId: 'task-5678efgh', toolName: 'file_ops' }, 'dev-z');
    });

    it('디바이스가 없어도 throw 하지 않는다 — 알림 실패가 작업을 흔들지 않게', () => {
        jest.spyOn(getLocalBridgeRegistry(), 'notify').mockReturnValue(false);

        expect(() => new RemoteExecutor('task-5678efgh', 'user-9').notifyApprovalPending('ask_human')).not.toThrow();
    });
});
