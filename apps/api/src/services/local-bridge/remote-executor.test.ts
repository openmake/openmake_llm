/**
 * RemoteExecutor 브라우저 폐기 회귀 테스트.
 *
 * 로컬 브라우저(D3)는 Electron 데스크톱 셸만 구현하던 기능이라 그 앱 제거와 함께 폐기됐다
 * (2026-08-23). 남은 디바이스(Companion·CLI)는 애초에 미지원이었다. 여기서 고정하는 계약:
 * 게이트가 항상 꺼져 있고, runBrowser 가 **브리지 요청을 내보내지 않고** 거절한다.
 * (컨테이너 샌드박스의 browser 도구는 무관하게 유지된다 — TASK_SANDBOX_BROWSER_ENABLED.)
 */
import { RemoteExecutor } from './remote-executor';
import { getLocalBridgeRegistry } from './registry';

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
