/**
 * 이름 설치 `플러그인@마켓플레이스` 해석 (마켓플레이스 남은 개발계획 v3.7 M5).
 *
 * 등록 카탈로그(enabled) → 별칭 일치 원본 → 스냅샷 항목 이름 일치 → 설치 입력(원본 URL·plugin·하위 경로).
 * DB 만 읽는다 — 원격 호출·사용자 왕복 없음. 실제 설치는 종전 설치 엔진이 그 원본 URL 로 하므로
 * 원본 정책(M2)·교차 저장소 항목 검사·draft 승인이 그대로 적용된다.
 *
 * 모르는 이름은 **후보만** 안내한다(자동 치환 금지). 별칭 기본값은 스냅샷 `name` 이며, 명시 별칭이 우선한다 —
 * 별칭이 비어 있는 원본은 그 `name` 을 다른 원본이 별칭으로 쓰지 않고 같은 `name` 의 무별칭 원본이 하나일 때만 이름으로 잡힌다.
 *
 * @module services/extensions/named-install
 */
import {
    NAMED_INSTALL_LIMITS,
    isValidMarketplaceAlias,
    parseNamedInstallRef,
} from '../../config/extension-named-install';
import type { ExtensionCatalogRow } from '../../data/repositories/extension-catalog-repository';

/** 해석 결과 — ImportInput 에 그대로 넣는다 */
export interface NamedInstallTarget {
    sourceId: string;
    marketplace: string;
    gitUrl: string;
    plugin: string;
    catalogSubpath: string | null;
}

/** 해석 실패 — message 는 `NAMED_INSTALL_*:` 로 시작하고 후보를 담는다(도구 텍스트·400 응답 공용).
 *  candidates 는 그대로 다시 넣을 수 있는 `플러그인@마켓플레이스` 형태다(모호한 별칭은 원본 URL — 관리자 조치 대상) */
export class NamedInstallError extends Error {
    constructor(
        public readonly code: 'NAMED_INSTALL_INVALID' | 'NAMED_INSTALL_UNKNOWN_MARKETPLACE' | 'NAMED_INSTALL_AMBIGUOUS_MARKETPLACE' | 'NAMED_INSTALL_UNKNOWN_PLUGIN',
        message: string,
        public readonly candidates: string[] = [],
    ) {
        super(`${code}: ${message}`);
        this.name = 'NamedInstallError';
    }
}

/** PURE: 원본별 이름 설치 별칭 — 명시 별칭 > (규칙에 맞는) 스냅샷 name > 없음 */
export function effectiveAliases(rows: ExtensionCatalogRow[]): Map<string, ExtensionCatalogRow[]> {
    const explicit = new Set(rows.map((r) => r.alias).filter((a): a is string => !!a));
    const map = new Map<string, ExtensionCatalogRow[]>();
    const add = (alias: string, row: ExtensionCatalogRow) => map.set(alias, [...(map.get(alias) ?? []), row]);
    for (const r of rows) {
        if (r.alias) add(r.alias, r);
        else if (r.name && isValidMarketplaceAlias(r.name) && !explicit.has(r.name)) add(r.name, r);
    }
    return map;
}

/** PURE: 편집 거리 (후보 정렬용) */
function editDistance(a: string, b: string): number {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}

/** PURE: 가까운 순 후보(대소문자 무시 포함 일치를 앞으로) */
export function rankCandidates(query: string, names: string[]): string[] {
    const q = query.toLowerCase();
    return [...new Set(names)]
        .map((n) => ({ n, d: n.toLowerCase().includes(q) || q.includes(n.toLowerCase()) ? -1 : editDistance(q, n.toLowerCase()) }))
        .sort((x, y) => x.d - y.d || x.n.localeCompare(y.n))
        .slice(0, NAMED_INSTALL_LIMITS.MAX_CANDIDATES)
        .map((x) => x.n);
}

/** PURE: 등록 원본 목록에서 `플러그인@마켓플레이스` 해석 */
export function resolveNamedInstallFrom(ref: string, rows: ExtensionCatalogRow[]): NamedInstallTarget {
    const parsed = parseNamedInstallRef(ref);
    if (!parsed) {
        throw new NamedInstallError('NAMED_INSTALL_INVALID',
            `"${ref}" — 형식은 플러그인@마켓플레이스 (영문·숫자·. _ -, 영문·숫자로 시작, .. 금지)`);
    }
    const byAlias = effectiveAliases(rows.filter((r) => r.enabled !== false));
    const matched = byAlias.get(parsed.marketplace) ?? [];
    if (matched.length === 0) {
        const markets = rankCandidates(parsed.marketplace, [...byAlias.keys()]);
        throw new NamedInstallError('NAMED_INSTALL_UNKNOWN_MARKETPLACE',
            `"${parsed.marketplace}" 는 등록된 마켓플레이스가 아닙니다. ${markets.length ? `등록된 마켓플레이스: ${markets.join(', ')} — 후보: ${markets.map((m) => `${parsed.plugin}@${m}`).join(', ')}` : '등록된 카탈로그가 없습니다 — 관리자가 카탈로그를 등록해야 합니다'}`,
            markets.map((m) => `${parsed.plugin}@${m}`));
    }
    if (matched.length > 1) {
        throw new NamedInstallError('NAMED_INSTALL_AMBIGUOUS_MARKETPLACE',
            `"${parsed.marketplace}" 이름을 쓰는 카탈로그가 ${matched.length}개입니다 — 관리자가 원본마다 별칭을 지정해야 합니다`,
            matched.map((r) => r.url));
    }
    const source = matched[0];
    const names = (source.plugins ?? []).map((p) => p.name);
    if (!names.includes(parsed.plugin)) {
        const candidates = rankCandidates(parsed.plugin, names);
        throw new NamedInstallError('NAMED_INSTALL_UNKNOWN_PLUGIN',
            `"${parsed.plugin}" 는 마켓플레이스 "${parsed.marketplace}" 에 없습니다.${candidates.length ? ` 후보: ${candidates.map((c) => `${c}@${parsed.marketplace}`).join(', ')}` : ''}`,
            candidates.map((c) => `${c}@${parsed.marketplace}`));
    }
    return {
        sourceId: source.id,
        marketplace: parsed.marketplace,
        gitUrl: source.url,
        plugin: parsed.plugin,
        catalogSubpath: source.source_subpath ?? null,
    };
}

/** 등록 원본(enabled)을 읽어 해석 — 저장소 주입(테스트) */
export async function resolveNamedInstall(
    ref: string,
    repo: { listEnabled(): Promise<ExtensionCatalogRow[]> },
): Promise<NamedInstallTarget> {
    if (!parseNamedInstallRef(ref)) return resolveNamedInstallFrom(ref, []);   // 형식 오류는 DB 조회 없이
    return resolveNamedInstallFrom(ref, await repo.listEnabled());
}
