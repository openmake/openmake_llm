/**
 * 확장 카탈로그 읽기 포트 (M1 갤러리 판정, 2026-11-27) — add-on 이 등록된 카탈로그 스냅샷과 그 원본의 설치본 근거를 읽는 문.
 *
 * add-on 은 Base 표(`extension_catalog_sources`·`user_extensions`)를 SQL 로 읽지 않는다(`addons-no-base-table-sql`).
 * 설치본 근거는 **판정용 사실만** 돌려준다 — 사용자 id·env·토큰은 싣지 않는다. 스킬 본문·호환 메타는 스킬 저장 add-on 의
 * 구성요소 저장 연산으로 읽고, 그 add-on 이 없으면 스킬 근거만 비운다(fail-open).
 * 읽기 전용이고 네트워크를 쓰지 않는다.
 *
 * @module runtime-ports/extension-catalog
 */
import { getComponentStore } from '../addon-host/addon-data';
import { getPool } from '../data/models/unified-database';
import { getCatalogSourceRow, listInstalledExtensionsBySources } from '../data/extension-catalog-lookup';

export interface CatalogPluginView {
    name: string;
    description?: string;
    version?: string;
    /** 동기화 시점 설치 가능성 — undefined = 판정 미상 */
    installable?: boolean;
    category?: string;
    /** 교차 저장소 항목의 실제 원본 URL */
    source?: string;
}

export interface CatalogSourceView {
    id: string;
    url: string;
    name: string;
    enabled: boolean;
    lastSyncedAt: string | null;
    plugins: CatalogPluginView[];
}

export interface InstalledSkillEvidence {
    name: string | null;
    fromCommand: boolean;
    assetCount: number;
    /** 설치 때 감지한 외부 관용구 마커(skill-compat) */
    markers: string[];
    /** 대응 도구가 없는 원문 도구 이름 */
    unsupportedTools: string[];
    /** 필수인데 없는 도구 */
    requiredMissing: string[];
    unsupportedFeatures: string[];
    blocked: boolean;
    /** 본문(상한까지) — 정적 패턴 검사용 */
    content: string | null;
}

export interface InstalledMcpEvidence {
    name: string;
    serverId: string | null;
    transportType: string | null;
    blockedByConvention: boolean;
    failed: boolean;
}

export interface InstalledExtensionEvidence {
    name: string;
    version: string;
    sourceUrl: string;
    sourcePath: string;
    /** 설치한 커밋(SHA) */
    commit: string;
    installedAt: string;
    /** plugin.json 의 공개 메타 — 게시자·라이선스·홈페이지 */
    author: string | null;
    license: string | null;
    homepage: string | null;
    /** 설치 리포트 경고의 코드 부분(`CODE: …` 의 CODE) */
    warningCodes: string[];
    skills: InstalledSkillEvidence[];
    mcpServers: InstalledMcpEvidence[];
    agentCount: number;
}

/** 한 설치본에서 본문까지 읽는 스킬 상한 — 거대 번들이 판정 요청을 붙잡지 않게 */
export const EVIDENCE_SKILLS_PER_EXTENSION_MAX = 40;
/** 정적 검사에 쓰는 본문 상한(문자) */
export const EVIDENCE_SKILL_CONTENT_MAX_CHARS = 64_000;

function rec(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
    return typeof v === 'string' && v ? v : null;
}
function strs(v: unknown): string[] {
    return arr(v).filter((x): x is string => typeof x === 'string');
}
function iso(v: Date | string | null): string | null {
    if (v === null) return null;
    return v instanceof Date ? v.toISOString() : String(v);
}

function toPlugin(raw: unknown): CatalogPluginView | null {
    const p = rec(raw);
    const name = str(p.name);
    if (!name) return null;
    return {
        name,
        ...(str(p.description) ? { description: str(p.description)! } : {}),
        ...(str(p.version) ? { version: str(p.version)! } : {}),
        ...(typeof p.installable === 'boolean' ? { installable: p.installable } : {}),
        ...(str(p.category) ? { category: str(p.category)! } : {}),
        ...(str(p.source) ? { source: str(p.source)! } : {}),
    };
}

function authorOf(plugin: Record<string, unknown>): string | null {
    if (typeof plugin.author === 'string') return str(plugin.author);
    return str(rec(plugin.author).name);
}

function warningCode(w: unknown): string | null {
    if (typeof w !== 'string') return null;
    const m = /^([A-Z][A-Z0-9_]+)(?::|$)/.exec(w);
    return m ? m[1] : null;
}

async function skillEvidence(raw: unknown): Promise<InstalledSkillEvidence> {
    const s = rec(raw);
    const base: InstalledSkillEvidence = {
        name: str(s.name),
        fromCommand: s.fromCommand === true,
        assetCount: arr(s.assets).length,
        markers: [], unsupportedTools: [], requiredMissing: [], unsupportedFeatures: [],
        blocked: false,
        content: null,
    };
    const skillId = str(s.skillId);
    if (!skillId) return base;
    try {
        const row = await getComponentStore('skills', getPool()).getImportedSkill(skillId);
        if (!row) return base;
        const meta = rec(row.manifest_meta);
        const compat = rec(meta.compat);
        const compatibility = rec(meta.compatibility);
        const mappings = arr(compat.toolMappings).map(rec);
        return {
            ...base,
            markers: strs(compat.markers),
            unsupportedTools: mappings.filter(m => m.to === null).map(m => str(m.from)).filter((x): x is string => !!x),
            requiredMissing: strs(compatibility.requiredMissing),
            unsupportedFeatures: strs(compatibility.unsupportedFeatures),
            blocked: !!str(compatibility.blockedReason),
            content: typeof row.content === 'string' ? row.content.slice(0, EVIDENCE_SKILL_CONTENT_MAX_CHARS) : null,
        };
    } catch {
        return base;   // 스킬 저장 add-on 이 없거나 조회 실패 — 설치 리포트 근거만
    }
}

export interface ExtensionCatalogPort {
    /** 카탈로그 원본 스냅샷 — 없으면 null */
    getSource(id: string): Promise<CatalogSourceView | null>;
    /** 원본 URL 들의 설치본 근거 — (원본, 이름)마다 최신 1건 */
    listInstalledEvidence(sourceUrls: readonly string[]): Promise<InstalledExtensionEvidence[]>;
}

export const extensionCatalogPort: ExtensionCatalogPort = {
    async getSource(id) {
        const row = await getCatalogSourceRow(id);
        if (!row) return null;
        return {
            id: row.id,
            url: row.url,
            name: row.name,
            enabled: row.enabled,
            lastSyncedAt: iso(row.last_synced_at),
            plugins: arr(row.plugins).map(toPlugin).filter((p): p is CatalogPluginView => p !== null),
        };
    },
    async listInstalledEvidence(sourceUrls) {
        const rows = await listInstalledExtensionsBySources(sourceUrls);
        const out: InstalledExtensionEvidence[] = [];
        for (const row of rows) {
            const manifest = rec(row.manifest);
            const plugin = rec(manifest.plugin);
            const components = rec(manifest.components);
            const skills = await Promise.all(arr(components.skills).slice(0, EVIDENCE_SKILLS_PER_EXTENSION_MAX).map(skillEvidence));
            out.push({
                name: row.name,
                version: row.version,
                sourceUrl: row.source_url,
                sourcePath: row.source_path,
                commit: row.source_ref,
                installedAt: iso(row.updated_at) ?? '',
                author: authorOf(plugin),
                license: str(plugin.license),
                homepage: str(plugin.homepage) ?? str(plugin.repository),
                warningCodes: [...new Set(arr(manifest.warnings).map(warningCode).filter((c): c is string => !!c))],
                skills,
                mcpServers: arr(components.mcpServers).map(rec).map(m => ({
                    name: str(m.name) ?? '',
                    serverId: str(m.serverId),
                    transportType: str(m.transportType),
                    blockedByConvention: m.blockedByConvention === true,
                    failed: !!str(m.error),
                })),
                agentCount: arr(components.agents).map(rec).filter(a => !!str(a.agentId)).length,
            });
        }
        return out;
    },
};
