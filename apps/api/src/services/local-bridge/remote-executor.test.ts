/**
 * RemoteExecutor 테스트 — 경로 정규화·코드 탐색·결과 불명·기기 유실 신호·로컬 브라우저.
 *
 * 로컬 브라우저는 2026-08-23 에 폐기됐다가(구 Electron 앱의 구현) 2026-10-04 에 공용 코어 구현으로 다시 들어왔다
 * (Companion P2). 게이트(LOCAL_BRIDGE_BROWSER_ENABLED)와 기기의 능력 목록이 모두 있어야 쓴다.
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

describe('RemoteExecutor 브라우저 기본값', () => {
    afterEach(() => jest.restoreAllMocks());

    it('기기가 연결돼 있지 않으면 isBrowserEnabled 는 false 다', () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'BROWSER_ENABLED', true);
        expect(new RemoteExecutor('task-1', 'user-none').isBrowserEnabled).toBe(false);
    });

    it('browserStatePath 는 없다 — 로그인 상태는 기기의 전용 프로필에 남는다', () => {
        expect(new RemoteExecutor('task-1', 'user-1').browserStatePath).toBeNull();
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


describe('RemoteExecutor 기기 유실 신호 — 기기 대기 판단용', () => {
    afterEach(() => jest.restoreAllMocks());
    const reply = (r: Record<string, unknown>) => jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue(r as never);

    it('기기에 닿지 않은 실패는 rerunnable, 한 번 읽으면 지워진다', async () => {
        reply({ ok: false, error: 'x', transport: 'no_device' });
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.exec('ls');
        expect(ex.consumeDeviceLoss()).toBe('rerunnable');
        expect(ex.consumeDeviceLoss()).toBeNull();
    });

    it('읽기 요청이 보낸 뒤 끊긴 것도 rerunnable — 다시 읽으면 된다', async () => {
        reply({ ok: false, error: 'x', transport: 'disconnected' });
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.readFile('a').catch(() => undefined);
        expect(ex.consumeDeviceLoss()).toBe('rerunnable');
    });

    it('쓰기·실행 요청이 보낸 뒤 끊기면 unknown, rerunnable 보다 우선한다', async () => {
        const ex = new RemoteExecutor('task-1', 'user-1');
        reply({ ok: false, error: 'x', transport: 'no_device' });
        await ex.readFile('a').catch(() => undefined);
        jest.restoreAllMocks();
        reply({ ok: false, error: 'x', transport: 'disconnected' });
        await ex.writeFile('a', 'b').catch(() => undefined);
        expect(ex.consumeDeviceLoss()).toBe('unknown');
    });

    it('시간 초과는 기기 유실이 아니다 — 기기는 연결돼 있다', async () => {
        reply({ ok: false, error: 'x', transport: 'timeout' });
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.exec('sleep 999');
        expect(ex.consumeDeviceLoss()).toBeNull();
    });

    it('정상 응답·기기가 돌려준 실패는 신호가 없다', async () => {
        reply({ ok: false, error: '파일 없음' });
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.readFile('a').catch(() => undefined);
        expect(ex.consumeDeviceLoss()).toBeNull();
    });

    it('기기 대기가 꺼져 있으면 신호를 내지 않는다', async () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'DEVICE_WAIT_ENABLED', false);
        reply({ ok: false, error: 'x', transport: 'no_device' });
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.exec('ls');
        expect(ex.consumeDeviceLoss()).toBeNull();
    });
});

describe('RemoteExecutor 로컬 브라우저 (Companion P2)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('게이트가 꺼져 있으면 기기가 지원해도 브라우저를 쓰지 않는다', () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'BROWSER_ENABLED', false);
        jest.spyOn(getLocalBridgeRegistry(), 'supports').mockReturnValue(true);
        expect(new RemoteExecutor('task-1', 'user-1').isBrowserEnabled).toBe(false);
    });

    it('게이트가 켜져 있어도 기기가 browser 를 알리지 않았으면 쓰지 않는다 (구버전 Companion)', () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'BROWSER_ENABLED', true);
        const supports = jest.spyOn(getLocalBridgeRegistry(), 'supports').mockReturnValue(false);
        expect(new RemoteExecutor('task-1', 'user-1', 'dev-9').isBrowserEnabled).toBe(false);
        expect(supports).toHaveBeenCalledWith('user-1', 'dev-9', 'browser');
        supports.mockReturnValue(true);
        expect(new RemoteExecutor('task-1', 'user-1', 'dev-9').isBrowserEnabled).toBe(true);
    });

    it('runBrowserSpec — 액션·사이트 정책·승인 호스트·작업 id 를 싣고, 기기가 알려 준 주소를 다음 판정의 시작점으로 쓴다', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({
            ok: true, exitCode: 0, stdout: JSON.stringify({ ok: true, finalUrl: 'https://other.example.net/page', results: [] }),
        });
        const ex = new RemoteExecutor('task-1', 'user-1');
        const actions = [{ type: 'goto', url: 'https://other.example.net/page' }];
        const r = await ex.runBrowserSpec({ actions, approvedHosts: ['other.example.net'] });
        expect(r.exitCode).toBe(0);
        expect(spy).toHaveBeenCalledWith('user-1', expect.objectContaining({
            kind: 'browser', actions, approvedHosts: ['other.example.net'], taskId: 'task-1', sitePolicy: { allow: [], deny: [] },
        }), LOCAL_BRIDGE.BROWSER_TIMEOUT_MS, undefined);
        // 다음 호출 — goto 없이 쓰기만 와도 마지막 주소(목록 밖)로 판정한다
        const plan = await ex.planBrowserSitePolicy([{ type: 'fill', selector: '#a', text: 'x' }]);
        expect(plan.offListWrites).toEqual([expect.objectContaining({ host: 'other.example.net' })]);
    });

    it('쓰기가 든 브라우저 요청이 보낸 뒤 끊기면 결과 불명, 읽기만 든 요청은 일반 오류', async () => {
        jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue({ ok: false, error: '원래 오류', transport: 'disconnected' });
        const ex = new RemoteExecutor('task-1', 'user-1');
        const write = await ex.runBrowserSpec({ actions: [{ type: 'click', selector: '#pay' }], approvedHosts: [] });
        expect(write.stderr).toContain('결과를 알 수 없습니다');
        expect(ex.consumeDeviceLoss()).toBe('unknown');
        const read = await ex.runBrowserSpec({ actions: [{ type: 'extractText' }], approvedHosts: [] });
        expect(read.stderr).toContain('원래 오류');
        expect(ex.consumeDeviceLoss()).toBe('rerunnable');
    });

    it('컨테이너용 runBrowser 경로로는 브리지 요청을 내보내지 않는다', async () => {
        const spy = jest.spyOn(getLocalBridgeRegistry(), 'request');
        const r = await new RemoteExecutor('task-1', 'user-1').runBrowser('.browser-actions.json');
        expect(r.exitCode).not.toBe(0);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('RemoteExecutor 브라우저 넘겨받기 신호 — 넘겨받기 주차 판단용', () => {
    afterEach(() => jest.restoreAllMocks());
    const reply = (r: Record<string, unknown>) => jest.spyOn(getLocalBridgeRegistry(), 'request').mockResolvedValue(r as never);
    const userControlResult = { ok: true, stdout: JSON.stringify({ ok: false, results: [], error: 'x', userControl: true }), exitCode: 1, userControl: true };

    it('기기가 넘겨받기 표식을 실어 돌려주면 browser_takeover — 한 번 읽으면 지워진다', async () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'TAKEOVER_PARK_ENABLED', true);
        reply(userControlResult);
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.runBrowserSpec({ actions: [{ type: 'snapshot' }], approvedHosts: [] });
        expect(ex.consumeDeviceLoss()).toBe('browser_takeover');
        expect(ex.consumeDeviceLoss()).toBeNull();
    });

    it('게이트가 꺼져 있으면 종전대로 오류 결과만 돌려준다', async () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'TAKEOVER_PARK_ENABLED', false);
        reply(userControlResult);
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.runBrowserSpec({ actions: [{ type: 'snapshot' }], approvedHosts: [] });
        expect(ex.consumeDeviceLoss()).toBeNull();
    });

    it('표식이 없는 구버전 기기의 거절은 주차 신호가 아니다', async () => {
        jest.replaceProperty(LOCAL_BRIDGE, 'TAKEOVER_PARK_ENABLED', true);
        reply({ ok: true, stdout: JSON.stringify({ ok: false, results: [], error: '사용자가 브라우저를 직접 조작하는 중' }), exitCode: 1 });
        const ex = new RemoteExecutor('task-1', 'user-1');
        await ex.runBrowserSpec({ actions: [{ type: 'snapshot' }], approvedHosts: [] });
        expect(ex.consumeDeviceLoss()).toBeNull();
    });
});
