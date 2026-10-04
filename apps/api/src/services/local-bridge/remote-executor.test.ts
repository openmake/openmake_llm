/**
 * RemoteExecutor 브라우저 폐기 회귀 테스트.
 *
 * 로컬 브라우저(D3)는 Electron 데스크톱 셸만 구현하던 기능이라 그 앱 제거와 함께 폐기됐다
 * (2026-08-23). 남은 디바이스(Companion·CLI)는 애초에 미지원이었다. 여기서 고정하는 계약:
 * 게이트가 항상 꺼져 있고, runBrowser 가 **브리지 요청을 내보내지 않고** 거절한다.
 * (컨테이너 샌드박스의 browser 도구는 무관하게 유지된다 — TASK_SANDBOX_BROWSER_ENABLED.)
 */
import type { WebSocket } from 'ws';
import { RemoteExecutor } from './remote-executor';
import { getLocalBridgeRegistry } from './registry';
import { LOCAL_BRIDGE } from '../../config/local-bridge';

describe('RemoteExecutor 경로 — 컨테이너 표기(/workspace) 정규화', () => {
    afterEach(() => jest.restoreAllMocks());

    it('worktree 격리가 없으면 /workspace/… 를 연결 폴더 기준 상대경로로 푼다', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: true, content: 'x' });
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.readFile('/workspace/calc.py');
        expect(spy).toHaveBeenLastCalledWith('user-1', expect.objectContaining({ kind: 'read', path: 'calc.py' }), undefined, undefined);
        await ex.readFile('./src/a.ts');
        expect(spy).toHaveBeenLastCalledWith('user-1', expect.objectContaining({ kind: 'read', path: 'src/a.ts' }), undefined, undefined);
    });

    it('worktree 격리 중이면 worktree 기준으로 옮긴다 — /workspace 접두가 경로에 섞이지 않는다', async () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'WORKTREE_ENABLED', true);
        jest.spyOn(getLocalBridgeRegistry(), 'getDevice').mockReturnValue({
            userId: 'user-1', deviceId: 'dev-1', label: 'mac · repo', folderName: 'repo', ws: {} as WebSocket, connectedAt: 0,
        });
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request').mockImplementation(async (_userId, payload) =>
            (payload.kind === 'worktree' ? { ok: true, worktreeRel: '.openmake/worktrees/task-1', branch: 'omk-task/task-1' } : { ok: true, content: 'x' }));
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.create();
        await ex.readFile('/workspace/src/a.ts');
        expect(spy).toHaveBeenLastCalledWith('user-1', expect.objectContaining({ kind: 'read', path: '.openmake/worktrees/task-1/src/a.ts' }), undefined, undefined);
        await ex.listDir('/workspace');
        expect(spy).toHaveBeenLastCalledWith('user-1', expect.objectContaining({ kind: 'list', path: '.openmake/worktrees/task-1' }), undefined, undefined);
    });
});

describe('RemoteExecutor detectTestRunner (확인 창 없는 러너 탐지)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('test_runner kind 로 묻고 exec(셸)을 쓰지 않는다', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: true, testRunner: 'npm' });
        expect(await new RemoteExecutor('task-1', 'user-1').detectTestRunner()).toBe('npm');
        expect(spy).toHaveBeenCalledWith('user-1', expect.objectContaining({ kind: 'test_runner', path: '.' }), undefined, undefined);
        expect(spy.mock.calls.every(([, payload]) => (payload as { kind: string }).kind !== 'exec')).toBe(true);
    });

    it("러너가 없으면 'none' 을 그대로 돌려준다(셸 프로브로 다시 묻지 않게)", async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: true, testRunner: 'none' });
        expect(await new RemoteExecutor('task-1', 'user-1').detectTestRunner()).toBe('none');
    });

    it('구 디바이스(미지원 kind)·실패·모르는 값은 null → 호출측이 셸 프로브로 폴백', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: false, error: '지원하지 않는 kind: test_runner' });
        expect(await new RemoteExecutor('task-1', 'user-1').detectTestRunner()).toBeNull();
        spy.mockRejectedValue(new Error('timeout'));
        expect(await new RemoteExecutor('task-1', 'user-1').detectTestRunner()).toBeNull();
        spy.mockResolvedValue({ ok: true, testRunner: 'rm -rf' });
        expect(await new RemoteExecutor('task-1', 'user-1').detectTestRunner()).toBeNull();
    });
});

describe('RemoteExecutor codeNav (읽기 전용 코드 탐색)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('code_nav kind 로 요청하고 결과를 그대로 돌려준다', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request')
            .mockResolvedValue({ ok: true, codeNav: { matches: ['src/a.ts:1:foo'], truncated: true } });
        const r = await new RemoteExecutor('task-1', 'user-1').codeNav({ op: 'grep', pattern: 'foo', path: 'src', glob: '*.ts' });
        expect(r).toEqual({ matches: ['src/a.ts:1:foo'], truncated: true });
        expect(spy).toHaveBeenCalledWith('user-1',
            expect.objectContaining({ kind: 'code_nav', op: 'grep', pattern: 'foo', path: 'src', glob: '*.ts' }),
            undefined, undefined);
    });

    it('exec(셸)을 쓰지 않는다 — 디바이스 승인 창을 띄우지 않는 것이 이 경로의 목적', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: true, codeNav: { files: [] } });
        await new RemoteExecutor('task-1', 'user-1').codeNav({ op: 'files' });
        expect(spy.mock.calls.every(([, payload]) => (payload as { kind: string }).kind !== 'exec')).toBe(true);
    });

    it('구 디바이스(미지원 kind)·실패는 null → 호출측이 셸로 폴백', async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: false, error: '지원하지 않는 kind: code_nav' });
        expect(await new RemoteExecutor('task-1', 'user-1').codeNav({ op: 'files' })).toBeNull();
    });

    it('codeNav 필드가 없는 응답도 null 로 본다', async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: true });
        expect(await new RemoteExecutor('task-1', 'user-1').codeNav({ op: 'grep', pattern: 'x' })).toBeNull();
    });
});

describe('RemoteExecutor 브라우저 폐기', () => {
    afterEach(() => jest.restoreAllMocks());

    it('isBrowserEnabled 는 env 와 무관하게 항상 false 다', () => {
        expect(new RemoteExecutor('task-1', 'user-1').isBrowserEnabled).toBe(false);
    });

    it('browserStatePath 는 없다', () => {
        expect(new RemoteExecutor('task-1', 'user-1').browserStatePath).toBeNull();
    });

    it('runBrowser 는 브리지를 호출하지 않고 폐기 안내로 거절한다', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request');
        const r = await new RemoteExecutor('task-1', 'user-1').runBrowser('.browser-actions.json');
        expect(r.exitCode).toBe(-1);
        expect(r.stderr).toContain('브라우저를 지원하지 않습니다');
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('RemoteExecutor 결과 불명 — 보낸 뒤 응답을 못 받은 쓰기·실행', () => {
    afterEach(() => jest.restoreAllMocks());
    const lost = (transport: 'timeout' | 'disconnected') => ({ ok: false, error: '원래 오류 문구', transport });

    it.each(['timeout', 'disconnected'] as const)('exec 가 %s 로 끝나면 결과 불명 안내를 돌려준다', async (transport) => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue(lost(transport));
        const r = await new RemoteExecutor('task-1', 'user-1').exec('npm run deploy');
        expect(r.exitCode).not.toBe(0);
        expect(r.stderr).toContain('결과를 알 수 없습니다');
        expect(r.stderr).toContain('반복하지 마세요');
    });

    it('writeFile·deleteFile 도 결과 불명 안내로 실패한다', async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue(lost('disconnected'));
        const ex = new RemoteExecutor('task-1', 'user-1');
        await expect(ex.writeFile('a.txt', 'x')).rejects.toThrow('결과를 알 수 없습니다');
        await expect(ex.deleteFile('a.txt')).rejects.toThrow('결과를 알 수 없습니다');
    });

    it('읽기 계열은 원래 오류 그대로 — 다시 시도해도 된다', async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue(lost('timeout'));
        const ex = new RemoteExecutor('task-1', 'user-1');
        await expect(ex.readFile('a.txt')).rejects.toThrow('원래 오류 문구');
        await expect(ex.listDir('.')).rejects.toThrow('원래 오류 문구');
    });

    it('기기에 닿지 않은 실패(no_device·send_failed)는 결과 불명이 아니다', async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: false, error: '연결된 로컬 디바이스가 없습니다', transport: 'no_device' });
        const r = await new RemoteExecutor('task-1', 'user-1').exec('ls');
        expect(r.stderr).toContain('연결된 로컬 디바이스가 없습니다');
        expect(r.stderr).not.toContain('결과를 알 수 없습니다');
    });

    it('기기가 직접 돌려준 실패는 그대로 전달한다', async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: false, error: '사용자가 명령 실행을 거부했습니다', exitCode: 126 });
        const r = await new RemoteExecutor('task-1', 'user-1').exec('rm -rf x');
        expect(r.stderr).toContain('거부');
    });
});

