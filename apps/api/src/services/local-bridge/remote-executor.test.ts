/**
 * RemoteExecutor 게이트 회귀 테스트.
 *
 * 배경: `isBrowserEnabled` 가 D1 시절 `false` 로 하드코딩돼 있어, D3 로컬 브라우저를 구현하고
 * `LOCAL_BRIDGE_BROWSER_ENABLED=true` 로 켠 뒤에도 tools.ts 의 browser 핸들러가 **진입 단계에서**
 * 막혔다(`runBrowser` 까지 도달조차 못 함). 라이브 E2E 에서만 드러난 갭이라 여기서 고정한다.
 */
import { LOCAL_BRIDGE } from '../../config/local-bridge';

jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, BROWSER_ENABLED: true },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RemoteExecutor } = require('./remote-executor');

describe('RemoteExecutor 브라우저 게이트', () => {
    it('isBrowserEnabled 가 LOCAL_BRIDGE.BROWSER_ENABLED 를 따른다 (하드코딩 false 금지)', () => {
        const ex = new RemoteExecutor('task-1', 'user-1');
        expect(ex.isBrowserEnabled).toBe(LOCAL_BRIDGE.BROWSER_ENABLED);
        expect(ex.isBrowserEnabled).toBe(true);
    });

    it('세션 영속은 데스크톱 파티션이 담당하므로 서버측 상태 파일은 없다', () => {
        expect(new RemoteExecutor('task-1', 'user-1').browserStatePath).toBeNull();
    });

    it('게이트가 꺼져 있으면 runBrowser 가 브리지를 호출하지 않고 거절한다', async () => {
        jest.resetModules();
        jest.doMock('../../config/local-bridge', () => ({
            LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, BROWSER_ENABLED: false },
        }));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { RemoteExecutor: Off } = require('./remote-executor');
        const ex = new Off('task-1', 'user-1');
        expect(ex.isBrowserEnabled).toBe(false);

        const r = await ex.runBrowser('.browser-actions.json');
        expect(r.exitCode).toBe(-1);
        expect(r.stderr).toContain('LOCAL_BRIDGE_BROWSER_ENABLED=false');
    });
});
