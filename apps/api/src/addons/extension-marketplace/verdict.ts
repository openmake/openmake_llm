/**
 * 갤러리 항목 호환 판정 — 순수 함수. 입력은 카탈로그 스냅샷 항목 + (있으면) 같은 원본의 설치본 근거 + MCP 관측이고,
 * 출력은 판정(supported·partial·unsupported)·사유 코드·공개 출처다. LLM·네트워크를 쓰지 않는다.
 *
 * 설치본이 없으면 본문 수준 검사는 하지 못하므로 `CONTENT_NOT_EVALUATED`(info)를 붙이고 스냅샷 판정만 한다.
 *
 * @module addons/extension-marketplace/verdict
 */
import type { CatalogPluginView, InstalledExtensionEvidence } from '../../runtime-ports/extension-catalog';
import type { McpServerInsight } from '../../runtime-ports/component-insights';
import {
    EXTENSION_KIND_REASON_MAP,
    MARKER_REASON_MAP,
    REASON_SEVERITY,
    SKILL_BODY_PATTERNS,
    WARNING_REASON_MAP,
    type ReasonCode,
    type ReasonSeverity,
    type Verdict,
} from './constants';

export interface VerdictReason {
    code: ReasonCode;
    severity: ReasonSeverity;
    /** 같은 사유가 걸린 구성요소 수(스킬·서버) — 0 이면 항목 단위 */
    count: number;
}

export interface VerdictProvenance {
    /** 게시자 — plugin.json author, 없으면 원본 URL 의 소유자 */
    publisher: string | null;
    /** 근거로 쓴 설치본의 커밋 */
    commit: string | null;
    license: string | null;
    sourceUrl: string;
}

export interface ComputedVerdict {
    plugin: string;
    verdict: Verdict;
    reasons: VerdictReason[];
    provenance: VerdictProvenance;
    /** 무엇으로 판정했나 — `snapshot`(스냅샷만) · `installed`(설치본 근거 포함) */
    evaluated: 'snapshot' | 'installed';
}

export interface VerdictInput {
    catalogUrl: string;
    plugin: CatalogPluginView;
    evidence: InstalledExtensionEvidence | null;
    insights: ReadonlyMap<string, McpServerInsight>;
}

/** PURE: 원본 URL 의 소유자(github·gitlab 형식 `host/owner/repo`) — 모르면 null */
export function ownerFromUrl(url: string): string | null {
    const m = /^(?:https?:\/\/|git@)[^/:]+[/:]([^/]+)\/[^/]+/i.exec(url.trim());
    return m ? decodeURIComponent(m[1]) : null;
}

/** PURE: 항목의 실제 원본 — 교차 저장소면 항목 source, 아니면 카탈로그 URL */
export function pluginSourceUrl(catalogUrl: string, plugin: CatalogPluginView): string {
    return plugin.source ?? catalogUrl;
}

class ReasonBag {
    private readonly counts = new Map<ReasonCode, number>();
    add(code: ReasonCode, n = 0): void {
        this.counts.set(code, (this.counts.get(code) ?? 0) + n);
    }
    list(): VerdictReason[] {
        return [...this.counts.entries()]
            .map(([code, count]) => ({ code, severity: REASON_SEVERITY[code], count }))
            .sort((a, b) => a.code.localeCompare(b.code));
    }
}

function skillReasons(evidence: InstalledExtensionEvidence, bag: ReasonBag): void {
    for (const s of evidence.skills) {
        const hit = new Set<ReasonCode>();
        for (const m of s.markers) {
            const code = MARKER_REASON_MAP[m];
            if (code) hit.add(code);
        }
        if (s.content) {
            for (const { code, pattern } of SKILL_BODY_PATTERNS) if (pattern.test(s.content)) hit.add(code);
        }
        if (s.unsupportedTools.length > 0) hit.add('SKILL_TOOL_UNSUPPORTED');
        if (s.requiredMissing.length > 0) hit.add('SKILL_REQUIRED_TOOL_MISSING');
        if (s.blocked) hit.add('SKILL_EXECUTION_BLOCKED');
        // commands/ 에서 바꾼 스킬은 번들 파일을 담지 않는다 — 디렉터리 밖 참조와 겹치면 참조가 깨진다
        if (s.fromCommand && hit.has('SKILL_ASSET_OUTSIDE_DIR')) hit.add('SKILL_COMMAND_ASSETS_SKIPPED');
        for (const code of hit) bag.add(code, 1);
    }
}

function mcpReasons(evidence: InstalledExtensionEvidence, insights: ReadonlyMap<string, McpServerInsight>, bag: ReasonBag): void {
    for (const m of evidence.mcpServers) {
        if (m.blockedByConvention) bag.add('MCP_BLOCKED_BY_CONVENTION', 1);
        const insight = m.serverId ? insights.get(m.serverId) : undefined;
        const transport = insight?.transport ?? m.transportType;
        if (transport === 'sse') bag.add('MCP_TRANSPORT_SSE_DEPRECATED', 1);
        if (!insight) continue;
        if (insight.authMethod === 'oauth-dynamic') bag.add('MCP_AUTH_DYNAMIC_REGISTRATION', 1);
        if (insight.protocolEra === 'modern') bag.add('MCP_PROTOCOL_MODERN', 1);
        else if (insight.protocolEra === 'legacy') bag.add('MCP_PROTOCOL_LEGACY', 1);
        for (const kind of new Set(insight.declaredExtensionKinds)) {
            const code = EXTENSION_KIND_REASON_MAP[kind];
            if (code) bag.add(code, 1);
        }
    }
}

function verdictOf(reasons: readonly VerdictReason[]): Verdict {
    if (reasons.some(r => r.severity === 'blocking')) return 'unsupported';
    if (reasons.some(r => r.severity === 'degrading')) return 'partial';
    return 'supported';
}

/** PURE: 판정 하나 */
export function computeVerdict(input: VerdictInput): ComputedVerdict {
    const { plugin, evidence, insights, catalogUrl } = input;
    const sourceUrl = pluginSourceUrl(catalogUrl, plugin);
    const bag = new ReasonBag();
    if (plugin.installable === false) bag.add('NOT_INSTALLABLE');
    if (plugin.source && plugin.source !== catalogUrl) bag.add('CROSS_REPO_SOURCE');
    if (evidence) {
        for (const w of evidence.warningCodes) {
            const code = WARNING_REASON_MAP[w];
            if (code) bag.add(code);
        }
        skillReasons(evidence, bag);
        mcpReasons(evidence, insights, bag);
    } else {
        // 설치 가능성 미상은 설치본이 있으면(실제로 설치됐으면) 해소된다
        if (plugin.installable === undefined) bag.add('INSTALLABILITY_UNKNOWN');
        bag.add('CONTENT_NOT_EVALUATED');
    }
    const reasons = bag.list();
    return {
        plugin: plugin.name,
        verdict: verdictOf(reasons),
        reasons,
        provenance: {
            publisher: evidence?.author ?? ownerFromUrl(sourceUrl),
            commit: evidence?.commit ?? null,
            license: evidence?.license ?? null,
            sourceUrl,
        },
        evaluated: evidence ? 'installed' : 'snapshot',
    };
}

/** PURE: 판정에 필요한 MCP 서버 id(설치본 근거에서) */
export function insightServerIds(evidence: readonly InstalledExtensionEvidence[]): string[] {
    return [...new Set(evidence.flatMap(e => e.mcpServers.map(m => m.serverId).filter((id): id is string => !!id)))];
}

/** PURE: 항목 → 근거(같은 원본 + 같은 이름) */
export function matchEvidence(
    catalogUrl: string,
    plugin: CatalogPluginView,
    evidence: readonly InstalledExtensionEvidence[],
): InstalledExtensionEvidence | null {
    const url = pluginSourceUrl(catalogUrl, plugin);
    return evidence.find(e => e.sourceUrl === url && e.name === plugin.name) ?? null;
}
