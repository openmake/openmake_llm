/**
 * 플러그인 번들 빌더 (순수) — DB 행 → 레포 파일 목록.
 *
 * 만드는 것은 Claude Code 플러그인 규격 그대로라 **우리 ingest 가 다시 읽을 수 있고**
 * Claude Code 도 설치할 수 있다:
 *
 *   plugins/<name>/.claude-plugin/plugin.json   name · version · description · author
 *   plugins/<name>/skills/<slug>/SKILL.md       frontmatter(name/description/category/version) + 본문
 *   plugins/<name>/skills/<slug>/<rel_path>     스킬 번들 파일(scripts/·references/·assets/) 원본 바이트
 *   plugins/<name>/agents/<slug>.md             frontmatter(name/description) + system_prompt
 *   plugins/<name>/.mcp.json                    mcpServers — env 는 `${KEY}` 자리표시자만
 *
 * 그리고 marketplace.json 에 넣을 상대경로 엔트리(`./plugins/<name>`)를 함께 돌려준다.
 *
 * ⚠️ 자격증명은 어떤 형태로도 나가지 않는다 — MCP env 는 키만 받아 자리표시자로 쓴다.
 *
 * @module services/marketplace/plugin-bundle-builder
 */
import yaml from 'js-yaml';
import { createHash } from 'crypto';
import { MARKETPLACE_AUTHOR, MARKETPLACE_PATHS, MARKETPLACE_PUBLISH_LIMITS } from '../../config/marketplace-publish';
import type { ExportAgent, ExportMcpServer, ExportSkill, ExportSkillAsset } from '../../data/repositories/marketplace-export-repository';

export interface BundleFile { path: string; content: string | Buffer }

export interface BundleInput {
    pluginName: string;
    description?: string;
    version?: string;
    category?: string;
    skills: ExportSkill[];
    assets: ExportSkillAsset[];
    agents: ExportAgent[];
    mcpServers: ExportMcpServer[];
}

export interface BundleResult {
    pluginDir: string;
    files: BundleFile[];
    /** marketplace.json plugins[] 엔트리 */
    marketplaceEntry: { name: string; description: string; category: string; source: string };
    totalBytes: number;
}

const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function validatePluginName(name: string): string | null {
    if (!PLUGIN_NAME_RE.test(name)) return 'plugin 이름은 소문자/숫자/대시(kebab-case), 80자 이하';
    if (name.length > MARKETPLACE_PUBLISH_LIMITS.pluginNameMax) return `plugin 이름은 ${MARKETPLACE_PUBLISH_LIMITS.pluginNameMax}자 이하`;
    return null;
}

/** 스킬 본문 앞의 기존 frontmatter 는 벗긴다 — 우리가 정규 frontmatter 를 다시 씌우므로 이중이 되면 파서가 첫 것만 읽는다 */
function stripFrontmatter(md: string): string {
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(md);
    return m ? md.slice(m[0].length) : md;
}

function frontmatter(obj: Record<string, unknown>): string {
    return `---\n${yaml.dump(obj, { lineWidth: -1, noRefs: true }).trimEnd()}\n---\n`;
}

/**
 * 디렉토리용 ASCII 슬러그 — 한글 등 비ASCII 는 버리고, 남는 게 없으면 이름 해시로 만든다.
 * 앱 내부 슬러그(`chat/slash-command.slugify`)는 유니코드를 보존하지만, 레포 경로는 Claude Code
 * 설치·다른 OS 파일시스템 호환을 위해 ASCII 로 고정한다. 원래 이름은 frontmatter `name` 에 그대로 남는다.
 */
export function asciiSlug(name: string, prefix: string): string {
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (base.length >= 3) return base.slice(0, 64);
    const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
    return base ? `${base}-${hash}` : `${prefix}-${hash}`;
}

/** 이름 충돌 시 -2, -3 … 을 붙여 유일하게 */
function uniqueSlug(base: string, taken: Set<string>): string {
    let s = base || 'item';
    let i = 2;
    while (taken.has(s)) s = `${base}-${i++}`;
    taken.add(s);
    return s;
}

export function buildPluginBundle(input: BundleInput): BundleResult {
    const nameErr = validatePluginName(input.pluginName);
    if (nameErr) throw new Error(nameErr);
    const L = MARKETPLACE_PUBLISH_LIMITS;
    if (input.skills.length > L.maxSkills) throw new Error(`스킬은 최대 ${L.maxSkills}개`);
    if (input.agents.length > L.maxAgents) throw new Error(`에이전트는 최대 ${L.maxAgents}개`);
    if (input.mcpServers.length > L.maxMcpServers) throw new Error(`MCP 서버는 최대 ${L.maxMcpServers}개`);
    if (input.skills.length + input.agents.length + input.mcpServers.length === 0) throw new Error('내보낼 구성요소가 없습니다');

    const dir = `${MARKETPLACE_PATHS.pluginsDir}/${input.pluginName}`;
    const files: BundleFile[] = [];
    let totalBytes = 0;
    const push = (path: string, content: string | Buffer) => {
        const bytes = typeof content === 'string' ? Buffer.byteLength(content) : content.length;
        totalBytes += bytes;
        if (totalBytes > L.maxTotalBytes) throw new Error(`번들 합계가 ${L.maxTotalBytes} 바이트를 넘습니다`);
        files.push({ path: `${dir}/${path}`, content });
    };

    // plugin.json
    push('.claude-plugin/plugin.json', JSON.stringify({
        name: input.pluginName,
        version: input.version ?? '1.0.0',
        description: input.description ?? '',
        author: MARKETPLACE_AUTHOR,
    }, null, 2) + '\n');

    // skills
    const skillSlugs = new Set<string>();
    const assetsBySkill = new Map<string, ExportSkillAsset[]>();
    for (const a of input.assets) {
        if (!assetsBySkill.has(a.skill_id)) assetsBySkill.set(a.skill_id, []);
        assetsBySkill.get(a.skill_id)!.push(a);
    }
    for (const s of input.skills) {
        const slug = uniqueSlug(asciiSlug(s.name, 'skill'), skillSlugs);
        const meta = (s.manifest_meta ?? {}) as { version?: unknown; tags?: unknown };
        const fm: Record<string, unknown> = {
            name: s.name,
            description: (s.description ?? '').trim() || s.name,
            category: s.category || 'general',
            version: typeof meta.version === 'string' && /^\d+\.\d+\.\d+$/.test(meta.version) ? meta.version : '1.0.0',
        };
        if (Array.isArray(meta.tags) && meta.tags.length) fm.tags = meta.tags.filter((t): t is string => typeof t === 'string').slice(0, 20);
        push(`skills/${slug}/SKILL.md`, frontmatter(fm) + '\n' + stripFrontmatter(s.content).trim() + '\n');
        for (const a of assetsBySkill.get(s.id) ?? []) {
            const rel = a.rel_path.replace(/^\.?\//, '');
            if (rel.includes('..') || rel.startsWith('/')) continue;  // path traversal 차단
            if (a.content.length > L.maxAssetBytes) continue;          // 상한 초과분은 건너뜀(본문 안내는 SKILL.md 에 이미 있음)
            push(`skills/${slug}/${rel}`, a.content);
        }
    }

    // agents — Claude Code agents/<name>.md 규격 (frontmatter + 본문 = system prompt)
    const agentSlugs = new Set<string>();
    for (const ag of input.agents) {
        const slug = uniqueSlug(asciiSlug(ag.name, 'agent'), agentSlugs);
        const fm: Record<string, unknown> = { name: ag.name, description: (ag.description ?? '').trim() || `${ag.name} 에이전트` };
        if (ag.model) fm.model = ag.model;
        push(`agents/${slug}.md`, frontmatter(fm) + '\n' + ag.system_prompt.trim() + '\n');
    }

    // .mcp.json — env 는 자리표시자만
    if (input.mcpServers.length > 0) {
        const mcpServers: Record<string, Record<string, unknown>> = {};
        for (const m of input.mcpServers) {
            const env = Object.fromEntries(m.env_keys.map((k) => [k, `\${${k}}`]));
            const entry: Record<string, unknown> = m.transport_type === 'stdio'
                ? { command: m.command, args: Array.isArray(m.args) ? m.args : [] }
                : { type: 'http', url: m.url };
            if (m.env_keys.length) entry.env = env;
            mcpServers[m.name] = entry;
        }
        push('.mcp.json', JSON.stringify({ mcpServers }, null, 2) + '\n');
    }

    return {
        pluginDir: dir,
        files,
        marketplaceEntry: {
            name: input.pluginName,
            description: input.description ?? '',
            category: input.category ?? 'custom',
            source: `./${dir}`,
        },
        totalBytes,
    };
}
