/**
 * Add-on 라우트 — 통합형 add-on 의 전용 라우트 마운트와 add-on 목록 API (Add-on 전환 P3, 2026-09-19).
 *
 * Base 라우팅(`routes/setup.ts`)은 개별 통합 기능의 라우터를 알지 않고 `mountAddonRoutes(app)` 만 부른다.
 * 꺼진 add-on 의 라우트는 마운트되지 않는다(404). MCP·Skill 런타임 라우트는 Base 라 여기 대상이 아니다.
 *
 * @module addon-host/routes
 */
import * as fs from 'fs';
import * as path from 'path';
import { Router, type Application } from 'express';
import { success } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { addonManifestSchema } from './manifest';
import { BUILTIN_ADDON_IDS, BUILTIN_ADDON_KIND, builtinAddonDir, isBuiltinAddonEnabled, type BuiltinAddonId } from './builtin-registry';

const logger = createLogger('AddonHost');

/** add-on 별 전용 라우트 — 라우터는 켜진 add-on 만 로드한다(지연 require). */
const ADDON_ROUTES: Readonly<Partial<Record<BuiltinAddonId, ReadonlyArray<{ mountPath: string; load: () => Router; within?: 'v1' }>>>> = {
    'notebooklm': [{ mountPath: '/api/mcp', load: () => (require('../addons/notebooklm/routes') as typeof import('../addons/notebooklm/routes')).notebooklmRouter }],
    // 카카오 지도 임베드 HTML(네이티브 앱 WKWebView 전용)은 /api 하위에 둔다 — 운영 프록시(Caddy/Next)가 /api 만
    // 백엔드로 보내 그 밖이면 외부 경로에서 404 다(2026-08-18 실측). GET 이라 CSRF 는 스킵되고 인증을 강제하지 않는다.
    'kakao-map': [{ mountPath: '/api/embed', load: () => (require('../addons/kakao-map/embed.routes') as typeof import('../addons/kakao-map/embed.routes')).default }],
    // 딥리서치 전용 REST API — 채팅 모드와 별개로 장시간 리서치를 시작·조회한다(v1 경로 포함)
    'deep-research': [
        { mountPath: '/api/research', load: () => (require('../addons/deep-research/routes') as typeof import('../addons/deep-research/routes')).default },
        // v1 은 API 키 인증·스코프·rate limit 이 걸린 v1 라우터 **안에** 마운트한다 — 앱에 직접 걸면 인증을 우회한다
        { within: 'v1', mountPath: '/research', load: () => (require('../addons/deep-research/routes') as typeof import('../addons/deep-research/routes')).default },
    ],
    'discord': [{ mountPath: '/api/integrations/discord', load: () => (require('../addons/discord/routes') as typeof import('../addons/discord/routes')).discordRuntimeRouter }],
};

/**
 * add-on 목록 — 매니페스트와 켜짐 여부는 프로세스 시작 시 고정이라 첫 요청에 한 번만 만든다(인증 없는 엔드포인트가
 * 요청마다 동기 파일 I/O 를 하지 않게). 매니페스트 하나를 못 읽어도 목록 전체를 실패시키지 않는다 — 그 add-on 은
 * id 를 이름으로 싣고 경고를 남긴다(부팅의 verifyBuiltinManifests 도 같은 문제를 경고한다).
 */
interface AddonListEntry { id: string; name: string; version: string; kind: 'content' | 'integration'; enabled: boolean }
let addonListCache: AddonListEntry[] | null = null;

export function listBuiltinAddons(): AddonListEntry[] {
    addonListCache ??= BUILTIN_ADDON_IDS.map(id => {
        const base = { id, kind: BUILTIN_ADDON_KIND[id], enabled: isBuiltinAddonEnabled(id) };
        try {
            const manifest = addonManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(builtinAddonDir(id), 'openmake-addon.json'), 'utf-8')));
            return { ...base, name: manifest.name, version: manifest.version };
        } catch (err) {
            logger.warn(`add-on '${id}' 매니페스트를 읽지 못함 — 목록에는 id 로 싣는다:`, err);
            return { ...base, name: id, version: '0.0.0' };
        }
    });
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

export function mountAddonRoutes(app: Application): void {
    app.use('/api/addons', createAddonListRouter());
    for (const id of BUILTIN_ADDON_IDS) {
        const routes = ADDON_ROUTES[id];
        if (!routes) continue;
        if (!isBuiltinAddonEnabled(id)) {
            logger.info(`add-on '${id}' 꺼짐 — 전용 라우트 미마운트`);
            continue;
        }
        for (const route of routes) if (!route.within) app.use(route.mountPath, route.load());
    }
}

/**
 * v1 라우터(`/api/v1/*`) 안에 걸리는 add-on 라우트 — v1 의 API 키 인증·스코프·rate limit 미들웨어 **뒤에서** 호출할 것.
 */
export function mountAddonV1Routes(v1Router: Router): void {
    for (const id of BUILTIN_ADDON_IDS) {
        if (!isBuiltinAddonEnabled(id)) continue;
        for (const route of ADDON_ROUTES[id] ?? []) if (route.within === 'v1') v1Router.use(route.mountPath, route.load());
    }
}
