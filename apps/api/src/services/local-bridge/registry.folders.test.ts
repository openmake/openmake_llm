/**
 * 폴더 선택(102, 2026-08-21) — 열거 캐시(enumeratedFolders) 검증.
 * folders 응답 병합, 루트 항상 유효, 미보고 폴더 거부, 재등록 시 캐시 리셋,
 * RemoteExecutor folder 첨부(요청 페이로드)를 검증한다.
 */
import { getLocalBridgeRegistry, type DeviceSession } from './registry';
import { RemoteExecutor } from './remote-executor';
import type { WebSocket } from 'ws';

function fakeWs(): { ws: WebSocket; sent: unknown[] } {
    const sent: unknown[] = [];
    const ws = {
        readyState: 1, OPEN: 1, close: jest.fn(),
        send: jest.fn((data: string) => sent.push(JSON.parse(data))),
    } as unknown as WebSocket;
    return { ws, sent };
}

function session(userId: string, deviceId: string, ws: WebSocket): DeviceSession {
    return { userId, deviceId, label: `dev-${deviceId}`, folderName: 'root', ws, connectedAt: Date.now() };
}

describe('LocalBridgeRegistry 폴더 선택 열거 캐시', () => {
    const reg = getLocalBridgeRegistry();
    const wsList: WebSocket[] = [];

    afterEach(() => {
        for (const ws of wsList.splice(0)) reg.unregister(ws);
    });

    function add(userId: string, deviceId: string): { ws: WebSocket; sent: unknown[] } {
        const f = fakeWs();
        wsList.push(f.ws);
        expect(reg.register(session(userId, deviceId, f.ws))).toBe(true);
        return f;
    }

    test('루트(빈값/미지정)는 항상 유효, 미보고 폴더는 거부된다', () => {
        add('u1', 'cli');
        expect(reg.isEnumeratedFolder('u1', 'cli', undefined)).toBe(true);
        expect(reg.isEnumeratedFolder('u1', 'cli', '')).toBe(true);
        expect(reg.isEnumeratedFolder('u1', 'cli', 'apps')).toBe(false);
    });

    test('noteEnumeratedFolders 병합 후 통과, 미등록 디바이스는 무시된다', () => {
        add('u1', 'cli');
        reg.noteEnumeratedFolders('u1', 'cli', ['apps', 'apps/web']);
        expect(reg.isEnumeratedFolder('u1', 'cli', 'apps')).toBe(true);
        expect(reg.isEnumeratedFolder('u1', 'cli', 'apps/web')).toBe(true);
        expect(reg.isEnumeratedFolder('u1', 'cli', 'docs')).toBe(false);
        // 미등록 디바이스에 대한 병합은 no-op, 조회는 false
        reg.noteEnumeratedFolders('u1', 'ghost', ['x']);
        expect(reg.isEnumeratedFolder('u1', 'ghost', 'x')).toBe(false);
    });

    test('같은 deviceId 재등록(재연결)은 열거 캐시를 리셋한다', () => {
        add('u1', 'cli');
        reg.noteEnumeratedFolders('u1', 'cli', ['apps']);
        expect(reg.isEnumeratedFolder('u1', 'cli', 'apps')).toBe(true);
        add('u1', 'cli'); // 재등록 — 다른 루트로 재연결됐을 수 있으므로 리셋
        expect(reg.isEnumeratedFolder('u1', 'cli', 'apps')).toBe(false);
        expect(reg.isEnumeratedFolder('u1', 'cli', '')).toBe(true);
    });
});

describe('RemoteExecutor 폴더 선택 folder 첨부', () => {
    const reg = getLocalBridgeRegistry();
    const wsList: WebSocket[] = [];

    afterEach(() => {
        for (const ws of wsList.splice(0)) reg.unregister(ws);
    });

    test('folderRel 지정 시 모든 브리지 요청 페이로드에 folder 가 실린다', async () => {
        const f = fakeWs();
        wsList.push(f.ws);
        reg.register(session('u1', 'cli', f.ws));
        const exec = new RemoteExecutor('task-1234-abcd', 'u1', 'cli', 'apps/web');
        // 왕복 응답을 기다리지 않고 발신 프레임만 검증 (결과는 타임아웃 전에 수동 해소).
        const p = exec.readFile('src/a.ts');
        const frame = f.sent[0] as { type: string; reqId: string; kind: string; path: string; folder?: string };
        expect(frame.type).toBe('bridge_exec');
        expect(frame.kind).toBe('read');
        expect(frame.folder).toBe('apps/web');
        reg.handleResult('u1', frame.reqId, { ok: true, content: 'x' }, 'cli');
        await expect(p).resolves.toBe('x');
    });

    test('folderRel 미지정이면 folder 필드가 없다 (현행 동작 회귀 없음)', async () => {
        const f = fakeWs();
        wsList.push(f.ws);
        reg.register(session('u1', 'cli', f.ws));
        const exec = new RemoteExecutor('task-1234-abcd', 'u1', 'cli');
        const p = exec.readFile('src/a.ts');
        const frame = f.sent[0] as { reqId: string; folder?: string };
        expect(frame.folder).toBeUndefined();
        reg.handleResult('u1', frame.reqId, { ok: true, content: 'y' }, 'cli');
        await expect(p).resolves.toBe('y');
    });
});
