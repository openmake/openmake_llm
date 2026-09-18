/**
 * 통합형 add-on 라우트 — 켜진 것만 마운트되고, 목록 API 가 켜짐 상태를 그대로 알린다.
 */
import type { Application } from 'express';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

type AddonRow = { id: string; enabled: boolean; kind: string };

/** env 는 호출 시점에 읽히므로 목록 조회까지 같은 env 범위 안에서 끝낸다. */
function mountWith(disabled: string | undefined): { paths: string[]; addons: AddonRow[] } {
    const before = process.env[ENV_KEY];
    if (disabled === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = disabled;
    try {
        const mounted: Array<{ path: string; handler: unknown }> = [];
        const app = { use: (path: string, handler: unknown) => { mounted.push({ path, handler }); } } as unknown as Application;
        jest.isolateModules(() => { require('../routes').mountAddonRoutes(app); });
        const listRouter = mounted.find(m => m.path === '/api/addons')!.handler as { stack: Array<{ route: { stack: Array<{ handle: (req: unknown, res: { json: (body: { data: { addons: AddonRow[] } }) => void }) => void }> } }> };
        let addons: AddonRow[] = [];
        listRouter.stack[0].route.stack[0].handle({}, { json: (body: { data: { addons: AddonRow[] } }) => { addons = body.data.addons; } });
        return { paths: mounted.map(m => m.path), addons };
    } finally {
        if (before === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = before;
    }
}

describe('mountAddonRoutes', () => {
    it('기본은 세 통합 라우트가 모두 마운트된다', () => {
        expect(mountWith(undefined).paths).toEqual(['/api/addons', '/api/mcp', '/api/embed', '/api/integrations/discord']);
    });

    it('꺼진 add-on 의 라우트는 마운트되지 않고, 목록 API 는 항상 마운트된다', () => {
        const { paths, addons } = mountWith('notebooklm,discord');
        expect(paths).toEqual(['/api/addons', '/api/embed']);
        expect(addons.find(a => a.id === 'notebooklm')).toMatchObject({ enabled: false, kind: 'integration' });
        expect(addons.find(a => a.id === 'kakao-map')).toMatchObject({ enabled: true, kind: 'integration' });
        expect(addons.find(a => a.id === 'industry-pack')).toMatchObject({ enabled: true, kind: 'content' });
    });
});
