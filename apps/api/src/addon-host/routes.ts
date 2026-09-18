/**
 * Add-on 라우트 — 통합형 add-on 의 전용 라우트 마운트와 add-on 목록 API (Add-on 전환 P3, 2026-09-19).
 *
 * Base 라우팅(`routes/setup.ts`)은 개별 통합 기능의 라우터를 알지 않고 `mountAddonRoutes(app)` 만 부른다.
 * 꺼진 add-on 의 라우트는 마운트되지 않는다(404). MCP·Skill 런타임 라우트는 Base 라 여기 대상이 아니다.
 *
 * @module addon-host/routes
 */
import { Router, type Application, type IRouter } from 'express';
import { success } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { enabledBuiltinAddons, isBuiltinAddonEnabled, listBuiltinAddonDefs } from './builtin-registry';
import { loadAddonEntry } from './entry-loader';

const logger = createLogger('AddonHost');

/**
 * add-on 목록 — 매니페스트와 켜짐 여부는 프로세스 시작 시 고정이라 첫 요청에 한 번만 만든다. 매니페스트를 못 읽은
 * add-on 은 발견 단계에서 빠진다(부팅 로그의 `매니페스트 오류` 경고로 드러난다).
 */
interface AddonListEntry { id: string; name: string; version: string; kind: 'content' | 'integration'; enabled: boolean }
let addonListCache: AddonListEntry[] | null = null;

export function listBuiltinAddons(): AddonListEntry[] {
    addonListCache ??= listBuiltinAddonDefs().map(a => ({
        id: a.id, name: a.manifest.name, version: a.manifest.version,
        kind: a.manifest.kind ?? 'content', enabled: isBuiltinAddonEnabled(a.id),
    }));
    return addonListCache;
}

/** `GET /api/addons` — 클라이언트가 꺼진 add-on 의 UI 를 숨기는 데 쓴다. 민감 정보 없음(인증 불요). */
function createAddonListRouter(): Router {
    const router = Router();
    router.get('/', (_req, res) => {
        res.json(success({ addons: listBuiltinAddons() }));
    });
    return router;
}

/** 매니페스트 `entry.routes` 가 선언한 전용 라우트 — 켜진 add-on 의 라우터만 로드한다(꺼지면 404). */
function mountDeclaredRoutes(target: IRouter, within: 'v1' | undefined): void {
    for (const addon of enabledBuiltinAddons()) {
        for (const route of addon.manifest.entry?.routes ?? []) {
            if (route.within !== within) continue;
            target.use(route.mountPath, loadAddonEntry<Router>(addon, route.module));
        }
    }
}

export function mountAddonRoutes(app: Application): void {
    app.use('/api/addons', createAddonListRouter());
    for (const addon of listBuiltinAddonDefs()) {
        if (addon.manifest.entry?.routes?.length && !isBuiltinAddonEnabled(addon.id)) logger.info(`add-on '${addon.id}' 꺼짐 — 전용 라우트 미마운트`);
    }
    mountDeclaredRoutes(app, undefined);
}

/**
 * v1 라우터(`/api/v1/*`) 안에 걸리는 add-on 라우트 — v1 의 API 키 인증·스코프·rate limit 미들웨어 **뒤에서** 호출할 것.
 * (앱에 직접 걸면 인증을 우회한다 — 매니페스트의 `within: 'v1'` 이 이 경로를 고른다.)
 */
export function mountAddonV1Routes(v1Router: Router): void {
    mountDeclaredRoutes(v1Router, 'v1');
}
