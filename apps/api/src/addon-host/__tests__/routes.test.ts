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
    it('기본은 통합 라우트가 모두 마운트된다 (v1 안에 걸리는 라우트는 여기서 걸지 않는다)', () => {
        expect(mountWith(undefined).paths).toEqual(['/api/addons', '/api/mcp', '/api/embed', '/api/integrations/discord', '/api/research']);
    });

    it('꺼진 add-on 의 라우트는 마운트되지 않고, 목록 API 는 항상 마운트된다', () => {
        const { paths, addons } = mountWith('notebooklm,discord');
        expect(paths).toEqual(['/api/addons', '/api/embed', '/api/research']);
        expect(addons.find(a => a.id === 'notebooklm')).toMatchObject({ enabled: false, kind: 'integration' });
        expect(addons.find(a => a.id === 'kakao-map')).toMatchObject({ enabled: true, kind: 'integration' });
        expect(addons.find(a => a.id === 'industry-pack')).toMatchObject({ enabled: true, kind: 'content' });
    });

    it('목록은 한 번만 만들어 재사용한다 (요청마다 매니페스트를 다시 읽지 않는다)', () => {
        jest.isolateModules(() => {
            const fsModule = require('fs');
            const spy = jest.spyOn(fsModule, 'readFileSync');
            const { listBuiltinAddons } = require('../routes');
            const first = listBuiltinAddons();
            const readsAfterFirst = spy.mock.calls.length;
            expect(listBuiltinAddons()).toBe(first);
            expect(spy.mock.calls.length).toBe(readsAfterFirst);
            expect(first.map((a: { id: string }) => a.id)).toContain('industry-pack');
            spy.mockRestore();
        });
    });

    it('v1 라우트는 v1 라우터에만 걸린다 — 앱에 직접 걸면 API 키 인증을 우회한다', () => {
        const before = process.env[ENV_KEY];
        delete process.env[ENV_KEY];
        try {
            const v1: string[] = [];
            jest.isolateModules(() => { require('../routes').mountAddonV1Routes({ use: (p: string) => { v1.push(p); } }); });
            expect(v1).toEqual(['/research']);
            expect(mountWith(undefined).paths).not.toContain('/api/v1/research');
        } finally {
            if (before !== undefined) process.env[ENV_KEY] = before;
        }
    });
});
