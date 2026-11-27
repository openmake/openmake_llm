/**
 * Add-on 라우트 — 통합형 add-on 의 전용 라우트 마운트와 add-on 목록 API (Add-on 전환 P3, 2026-09-19).
 *
 * Base 라우팅(`routes/setup.ts`)은 개별 통합 기능의 라우터를 알지 않고 `mountAddonRoutes(app)` 만 부른다.
 * 꺼진 add-on 의 라우트는 마운트되지 않는다(404). MCP·Skill 런타임 라우트는 Base 라 여기 대상이 아니다.
 *
 * @module addon-host/routes
 */
import { Router, type Application, type IRouter, type NextFunction, type Request, type Response } from 'express';
import { error, success } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { enabledBuiltinAddons, isBuiltinAddonEnabled, listBuiltinAddonDefs } from './builtin-registry';
import type { ADDON_KINDS } from './manifest';
import { loadAddonEntry } from './entry-loader';
import { isAddonListReflectDbStateEnabled } from '../config/addon-list-state';

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

/** 테스트 전용 — 목록 캐시를 비운다(매니페스트·env 를 바꿔 가며 같은 모듈로 검증할 때) */
export function __resetAddonListCacheForTest(): void {
    addonListCache = null;
}

/** `GET /api/addons` — 클라이언트가 꺼진 add-on 의 UI 를 숨기는 데 쓴다. 민감 정보 없음(인증 불요). */
function createAddonListRouter(): Router {
    const router = Router();
    router.get('/', (_req, res) => {
        // 기본 꺼짐 add-on 이 없고 DB 상태 반영(opt-in)도 꺼져 있으면 종전과 같은 동기 응답(env 판정) — 기존 add-on 의 목록 계약 그대로
        if (defaultOffAddonIds().size === 0 && !isAddonListReflectDbStateEnabled()) {
            res.json(success({ addons: listBuiltinAddons() }));
            return;
        }
        void listAddonsForClient().then(addons => res.json(success({ addons })));
    });
    return router;
}

/** 매니페스트 `defaultState: disabled` 를 선언한 내장 add-on id */
function defaultOffAddonIds(): Set<string> {
    return new Set(listBuiltinAddonDefs().filter(a => a.manifest.defaultState === 'disabled').map(a => a.id));
}

/**
 * 클라이언트용 목록 — 종전 add-on 은 env 판정(`listBuiltinAddons`) 그대로다. `defaultState: disabled` add-on 만 DB 상태까지
 * 겹친다: 관리자가 켜기 전에는 진입점을 숨겨야 해서다(관리자 토글은 요청마다 반영된다). 상태를 확인하지 못하면 꺼짐으로 답한다.
 *
 * `ADDON_LIST_REFLECT_DB_STATE`(opt-in, §8-4)가 켜져 있으면 **종전 add-on 도** 라우트 게이트와 같은 판정
 * (`readAddonEnabledStrict` — env × DB 상태 × 이 프로세스의 준비 상태)으로 답한다: 게이트가 404(꺼짐)·503 `ADDON_FAILED`(미준비)로
 * 답할 add-on 은 `enabled:false` 라 웹이 진입점을 숨긴다. 단 **확인 불가**(게이트는 재시도 가능한 503 `ADDON_STATE_UNKNOWN` — 꺼짐과
 * 구분한다)에는 꺼짐을 주장하지 않고 종전 env 판정을 둔다 — 웹의 종전 add-on 은 fail-open(일시 오류로 기능이 사라지지 않게)이다.
 */
export async function listAddonsForClient(): Promise<AddonListEntry[]> {
    const base = listBuiltinAddons();
    const defaultOff = defaultOffAddonIds();
    const reflectAll = isAddonListReflectDbStateEnabled();
    if (defaultOff.size === 0 && !reflectAll) return base;
    const { readAddonEnabledStrict } = await import('../services/addon/addon-state');
    return Promise.all(base.map(async (a) => {
        if (!a.enabled) return a;
        if (defaultOff.has(a.id)) {
            const verdict = await readAddonEnabledStrict(a.id).catch(() => ({ known: false as const }));
            return { ...a, enabled: verdict.known && verdict.enabled };
        }
        if (!reflectAll) return a;
        const verdict = await readAddonEnabledStrict(a.id).catch(() => ({ known: false as const }));
        return verdict.known ? { ...a, enabled: verdict.enabled } : a;
    }));
}

/** 확인 불가 응답 — 503 + Retry-After. 꺼짐(404)·조직 밖(403)과 구분해 클라이언트가 재시도할 수 있게 한다(설계 문서 8.3). */
const RETRY_AFTER_SECONDS = '5';
function respondStateUnknown(res: Response, addonId: string): void {
    res.status(503).set('Retry-After', RETRY_AFTER_SECONDS)
        .json(error('ADDON_STATE_UNKNOWN', `add-on '${addonId}' 상태를 지금 확인할 수 없습니다. 잠시 후 다시 시도하세요.`));
}

/**
 * add-on 전용 라우트의 게이트 — 요청마다 상태와 사용권을 본다 (2026-09-19, S3; 2026-10-16 확인 불가 503).
 *
 * env 로 끈 add-on 은 아예 마운트되지 않지만(코드도 로드하지 않는다), **관리자가 DB 에서 끈** add-on 은
 * 재시작 없이 즉시 404 가 된다. 조직 정책 `ADDON_ALLOWLIST` 를 둔 조직에서 목록 밖이면 403(조직 관리자의 통제 — 과금 아님).
 * 상태·정책을 확인하지 못하면(DB 장애) 503 `ADDON_STATE_UNKNOWN` — 종전의 fail-open(통과)은 꺼진 add-on 을 장애 중에 열었다.
 * 이 서버에서 준비되지 않은 add-on(`state=failed`·이 프로세스의 부팅 실패·재시작 필요)은 503 `ADDON_FAILED` — 관리자 조치가 필요하므로 `Retry-After` 를 붙이지 않는다
 * (종전에는 꺼짐과 같은 404 라 "관리자가 껐다"로 잘못 읽혔다).
 */
export function addonGuard(addonId: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        void (async () => {
            try {
                // ⚠️ 이 게이트는 add-on 라우터의 자체 인증(requireAuth 등)보다 **먼저** 돌고, 앱에는 전역 인증
                // 미들웨어가 없다 — 그대로 두면 req.user 가 늘 비어 조직 사용권 축이 통째로 건너뛰어진다
                // (2026-09-20 라이브 검증에서 발견: allowlist 밖 add-on 이 403 이 아니라 200). 거절하지 않는
                // optionalAuth 로 문맥만 채운다. v1 라우터 안에서는 앞선 인증이 이미 채워 두었으므로 건너뛴다.
                if (!req.user) {
                    const { optionalAuth } = await import('../auth');
                    await new Promise<void>((resolve) => {
                        // optionalAuth 가 reject 해도(토큰 검증 중 DB 장애 등) 요청이 멈추거나 unhandledRejection 이 되지 않게 — 사용자 없이 판정을 계속한다
                        Promise.resolve(optionalAuth(req, res, () => resolve())).catch(() => resolve());
                    });
                }
                const { checkAddonEntitlement } = await import('../services/addon/entitlement');
                const userId = req.user?.id !== undefined ? String(req.user.id) : undefined;
                const verdict = await checkAddonEntitlement(addonId, userId);
                if (verdict === 'disabled') {
                    res.status(404).json({ success: false, error: { code: 'ADDON_DISABLED', message: `add-on '${addonId}' 이 비활성 상태입니다.` } });
                    return;
                }
                if (verdict === 'failed') {
                    res.status(503).json(error('ADDON_FAILED', `add-on '${addonId}' 이 이 서버에서 준비되지 않았습니다(부팅 실패 또는 재시작 필요). 관리자에게 문의하세요.`));
                    return;
                }
                if (verdict === 'not-entitled') {
                    res.status(403).json({ success: false, error: { code: 'ADDON_NOT_ENTITLED', message: `add-on '${addonId}' 사용권이 없습니다. 관리자에게 문의하세요.` } });
                    return;
                }
                if (verdict === 'state-unknown') {
                    respondStateUnknown(res, addonId);
                    return;
                }
            } catch (err) {
                logger.warn(`add-on '${addonId}' 게이트 판정 실패(503): ${err instanceof Error ? err.message : String(err)}`);
                // 이미 응답이 나간 뒤 던진 경우 이중 전송으로 unhandledRejection 이 되지 않게
                if (!res.headersSent) respondStateUnknown(res, addonId);
                return;
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
