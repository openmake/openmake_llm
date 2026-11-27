/**
 * 큐레이션 add-on 라우터 진입점 — 매니페스트 `entry.routes` 의 `routes#<export>` 가 모두 Express 라우터로 풀린다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as routes from '../routes';

const MANIFEST = resolve(__dirname, '../../../../addons/builtin/extension-curation/openmake-addon.json');

it('매니페스트가 가리키는 export 마다 라우터가 있고, 기본 켜짐이다', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { defaultState?: string; entry: { routes: Array<{ mountPath: string; module: string }> } };
    expect(manifest.defaultState).toBeUndefined();
    expect(manifest.entry.routes.map((r) => r.mountPath)).toEqual(['/api/users/me/extensions/gallery', '/api/users/me/extensions/:id/visibility', '/api/marketplace']);
    for (const r of manifest.entry.routes) {
        const name = r.module.split('#')[1] as keyof typeof routes;
        expect(typeof routes[name]).toBe('function');
        expect((routes[name] as unknown as { stack: unknown[] }).stack.length).toBeGreaterThan(0);
    }
});
