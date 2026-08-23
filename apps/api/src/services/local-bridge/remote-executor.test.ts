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
