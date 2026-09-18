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
const ADDON_ROUTES: Readonly<Partial<Record<BuiltinAddonId, ReadonlyArray<{ mountPath: string; load: () => Router }>>>> = {
    'notebooklm': [{ mountPath: '/api/mcp', load: () => (require('../routes/notebooklm.routes') as typeof import('../routes/notebooklm.routes')).notebooklmRouter }],
    // 카카오 지도 임베드 HTML(네이티브 앱 WKWebView 전용)은 /api 하위에 둔다 — 운영 프록시(Caddy/Next)가 /api 만
    // 백엔드로 보내 그 밖이면 외부 경로에서 404 다(2026-08-18 실측). GET 이라 CSRF 는 스킵되고 인증을 강제하지 않는다.
    'kakao-map': [{ mountPath: '/api/embed', load: () => (require('../routes/kakao-map-embed.routes') as typeof import('../routes/kakao-map-embed.routes')).default }],
    'discord': [{ mountPath: '/api/integrations/discord', load: () => (require('../routes/discord-runtime.routes') as typeof import('../routes/discord-runtime.routes')).discordRuntimeRouter }],
};

/** `GET /api/addons` — 클라이언트가 꺼진 add-on 의 UI 를 숨기는 데 쓴다. 민감 정보 없음(인증 불요). */
function createAddonListRouter(): Router {
    const router = Router();
    router.get('/', (_req, res) => {
        const addons = BUILTIN_ADDON_IDS.map(id => {
            const manifest = addonManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(builtinAddonDir(id), 'openmake-addon.json'), 'utf-8')));
            return { id, name: manifest.name, version: manifest.version, kind: BUILTIN_ADDON_KIND[id], enabled: isBuiltinAddonEnabled(id) };
        });
        res.json(success({ addons }));
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
        for (const route of routes) app.use(route.mountPath, route.load());
    }
}
