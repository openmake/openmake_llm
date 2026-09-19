/**
 * Add-on 라우트 — 통합형 add-on 의 전용 라우트 마운트와 add-on 목록 API (Add-on 전환 P3, 2026-09-19).
 *
 * Base 라우팅(`routes/setup.ts`)은 개별 통합 기능의 라우터를 알지 않고 `mountAddonRoutes(app)` 만 부른다.
 * 꺼진 add-on 의 라우트는 마운트되지 않는다(404). MCP·Skill 런타임 라우트는 Base 라 여기 대상이 아니다.
 *
 * @module addon-host/routes
 */
import { Router, type Application, type IRouter, type NextFunction, type Request, type Response } from 'express';
import { success } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { enabledBuiltinAddons, isBuiltinAddonEnabled, listBuiltinAddonDefs } from './builtin-registry';
import type { ADDON_KINDS } from './manifest';
import { loadAddonEntry } from './entry-loader';

const logger = createLogger('AddonHost');

type AddonKind = (typeof ADDON_KINDS)[number];

/**
 * add-on 목록 — 매니페스트와 켜짐 여부는 프로세스 시작 시 고정이라 첫 요청에 한 번만 만든다. 매니페스트를 못 읽은
 * add-on 은 발견 단계에서 빠진다(부팅 로그의 `매니페스트 오류` 경고로 드러난다).
 */
interface AddonListEntry { id: string; name: string; version: string; kind: AddonKind; enabled: boolean }
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

/**
 * add-on 전용 라우트의 게이트 — 요청마다 상태와 사용권을 본다 (2026-09-19, S3).
 *
 * env 로 끈 add-on 은 아예 마운트되지 않지만(코드도 로드하지 않는다), **관리자가 DB 에서 끈** add-on 은
 * 재시작 없이 즉시 404 가 된다. 조직 정책 `ADDON_ALLOWLIST` 에 없으면 403(유료 팩 미구매).
 * 판정 실패는 통과시킨다(fail-open) — 정책 조회 장애가 기능을 막지 않는다.
 */
function addonGuard(addonId: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        void (async () => {
            try {
                const { checkAddonEntitlement } = await import('../services/addon/entitlement');
                const userId = req.user?.id !== undefined ? String(req.user.id) : undefined;
                const verdict = await checkAddonEntitlement(addonId, userId);
                if (verdict === 'disabled') {
                    res.status(404).json({ success: false, error: { code: 'ADDON_DISABLED', message: `add-on '${addonId}' 이 비활성 상태입니다.` } });
                    return;
                }
                if (verdict === 'not-entitled') {
                    res.status(403).json({ success: false, error: { code: 'ADDON_NOT_ENTITLED', message: `add-on '${addonId}' 사용권이 없습니다. 관리자에게 문의하세요.` } });
                    return;
                }
            } catch (err) {
                logger.debug(`add-on '${addonId}' 게이트 판정 실패(통과): ${err instanceof Error ? err.message : String(err)}`);
            }
            next();
        })();
    };
}

/**
 * 매니페스트 `entry.routes` 가 선언한 전용 라우트.
 * env 로 끈 add-on 의 코드는 로드하지 않고, 나머지는 게이트 뒤에 건다(관리자 토글·사용권은 요청 시 판정).
 */
function mountDeclaredRoutes(target: IRouter, within: 'v1' | undefined): void {
    for (const addon of enabledBuiltinAddons()) {
        for (const route of addon.manifest.entry?.routes ?? []) {
            if (route.within !== within) continue;
            target.use(route.mountPath, addonGuard(addon.id), loadAddonEntry<Router>(addon, route.module));
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
