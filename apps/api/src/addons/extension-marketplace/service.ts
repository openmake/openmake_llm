/**
 * 카탈로그 판정 서비스 — 캐시가 신선하면 그대로, 아니면 스냅샷·설치본 근거·MCP 관측으로 다시 계산해 저장한다.
 *
 * 신선함 = 같은 판정 버전 + 만료 전 + 카탈로그 마지막 동기화 시각이 같다. 저장 실패는 계산 결과를 그대로 돌려준다(fail-open).
 * 외부로 아무것도 보내지 않는다 — 읽는 것은 Base 포트(카탈로그·설치본)와 구성요소 관측 포트뿐이다.
 *
 * @module addons/extension-marketplace/service
 */
import { AppError } from '../../utils/error-handler';
import { createLogger } from '../../utils/logger';
import { getPool } from '../../runtime-ports/db-access';
import { extensionCatalogPort, type ExtensionCatalogPort } from '../../runtime-ports/extension-catalog';
import { getMcpServerInsights } from '../../runtime-ports/component-insights';
import { VERDICT_TTL_MS, VERDICT_VERSION } from './constants';
import { computeVerdict, insightServerIds, matchEvidence, pluginSourceUrl, type ComputedVerdict } from './verdict';
import { VerdictRepository, type CachedVerdict } from './verdict-repository';

const logger = createLogger('ExtensionMarketplace');

export interface CatalogVerdicts {
    catalogId: string;
    verdictVersion: number;
    verdicts: Array<ComputedVerdict & { computedAt: string }>;
}

export interface VerdictServiceDeps {
    catalog: ExtensionCatalogPort;
    repo: () => VerdictRepository;
    insights: typeof getMcpServerInsights;
    now: () => number;
}

const defaultDeps: VerdictServiceDeps = {
    catalog: extensionCatalogPort,
    repo: () => new VerdictRepository(getPool()),
    insights: getMcpServerInsights,
    now: () => Date.now(),
};

function isFresh(c: CachedVerdict, syncedAt: string | null, now: number): boolean {
    return c.verdictVersion === VERDICT_VERSION
        && Date.parse(c.expiresAt) > now
        && (c.catalogSyncedAt === null ? syncedAt === null : syncedAt !== null && Date.parse(c.catalogSyncedAt) === Date.parse(syncedAt));
}

export async function getCatalogVerdicts(
    catalogId: string,
    deps: VerdictServiceDeps = defaultDeps,
): Promise<CatalogVerdicts> {
    const source = await deps.catalog.getSource(catalogId);
    // 갤러리는 꺼진 원본을 보이지 않는다 — 판정도 같은 규칙
    if (!source || !source.enabled) {
        throw new AppError('카탈로그를 찾을 수 없습니다', 404, true, 'CATALOG_NOT_FOUND');
    }
    const now = deps.now();
    const repo = deps.repo();
    let cached: CachedVerdict[] = [];
    try {
        cached = await repo.listByCatalog(catalogId);
    } catch (err) {
        logger.warn(`판정 캐시 조회 실패 — 다시 계산: ${err instanceof Error ? err.message : String(err)}`);
    }
    const byPlugin = new Map(cached.map(c => [c.plugin, c]));
    const stale = source.plugins.filter(p => {
        const c = byPlugin.get(p.name);
        return !c || !isFresh(c, source.lastSyncedAt, now);
    });

    const computed = new Map<string, ComputedVerdict>();
    if (stale.length > 0) {
        const urls = [...new Set(stale.map(p => pluginSourceUrl(source.url, p)))];
        const evidence = await deps.catalog.listInstalledEvidence(urls);
        const insights = await deps.insights(insightServerIds(evidence));
        for (const plugin of stale) {
            computed.set(plugin.name, computeVerdict({
                catalogUrl: source.url,
                plugin,
                evidence: matchEvidence(source.url, plugin, evidence),
                insights,
            }));
        }
        try {
            await repo.upsertMany(catalogId, [...computed.values()], {
                verdictVersion: VERDICT_VERSION,
                catalogSyncedAt: source.lastSyncedAt,
                expiresAt: new Date(now + VERDICT_TTL_MS),
            });
            await repo.deleteMissing(catalogId, source.plugins.map(p => p.name));
        } catch (err) {
            logger.warn(`판정 캐시 저장 실패(계산 결과는 그대로 응답): ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const nowIso = new Date(now).toISOString();
    return {
        catalogId,
        verdictVersion: VERDICT_VERSION,
        verdicts: source.plugins.map(p => {
            const fresh = computed.get(p.name);
            if (fresh) return { ...fresh, computedAt: nowIso };
            const c = byPlugin.get(p.name)!;
            return { plugin: c.plugin, verdict: c.verdict, reasons: c.reasons, provenance: c.provenance, evaluated: c.evaluated, computedAt: c.computedAt };
        }),
    };
}
