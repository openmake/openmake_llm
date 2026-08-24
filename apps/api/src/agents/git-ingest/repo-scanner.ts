/**
 * Tree entries → SKILL.md 후보 추출 (순수 함수).
 *
 * 자동 탐지 규칙 (우선순위):
 *   1. 명시 gitPath 지정 시 그것만 (단, tree 에 존재해야 함)
 *   2. root SKILL.md
 *   3. *.skill.md / *.SKILL.md (대소문자 무관)
 *   4. skills/ 하위의 *.md
 *
 * @module agents/git-ingest/repo-scanner
 */
import type { TreeEntry } from './git-fetcher';
import { UNSUPPORTED_EXTENSION_COMPONENTS } from '../../config/skill-compat';

export interface ManifestCandidate {
    path: string;
    sha: string;
    size: number;
}

const MANIFEST_PATTERNS = [
    /^SKILL\.md$/i,                  // root SKILL.md
    /\.skill\.md$/i,                 // *.skill.md / *.SKILL.md (suffix 대소문자 무관)
    /^skills\/.+\.md$/i,             // skills/ 하위 모든 .md
];

export function scanForSkillManifests(tree: TreeEntry[], explicitPath?: string): ManifestCandidate[] {
    if (explicitPath) {
        const hit = tree.find(e => e.path === explicitPath);
        return hit ? [{ path: hit.path, sha: hit.sha, size: hit.size }] : [];
    }
    return tree
        .filter(e => MANIFEST_PATTERNS.some(re => re.test(e.path)))
        .map(e => ({ path: e.path, sha: e.sha, size: e.size }));
}

/**
 * AGENT.md 후보 탐지 (Phase 3).
 *
 * 자동 탐지 규칙:
 *   1. 명시 explicitPath 지정 시 그것만
 *   2. root AGENT.md
 *   3. *.AGENT.md / *.agent.md
 *   4. agents/ 하위의 *.md
 */
const AGENT_MANIFEST_PATTERNS = [
    /^AGENT\.md$/i,
    /\.agent\.md$/i,
    /^agents\/.+\.md$/i,
];

export function scanForAgentManifests(tree: TreeEntry[], explicitPath?: string): ManifestCandidate[] {
    if (explicitPath) {
        const hit = tree.find(e => e.path === explicitPath);
        return hit ? [{ path: hit.path, sha: hit.sha, size: hit.size }] : [];
    }
    return tree
        .filter(e => AGENT_MANIFEST_PATTERNS.some(re => re.test(e.path)))
        .map(e => ({ path: e.path, sha: e.sha, size: e.size }));
}

/**
 * MCPSERVER.md 후보 탐지 (Phase 4).
 *
 * 자동 탐지 규칙:
 *   1. 명시 explicitPath 지정 시 그것만
 *   2. root MCPSERVER.md (대소문자 무관)
 *   3. *.mcpserver.md / *.MCPSERVER.md / *.mcp-server.md
 *   4. mcp-servers/ 하위의 *.md
 */
const MCP_SERVER_MANIFEST_PATTERNS = [
    /^MCPSERVER\.md$/i,
    /\.mcpserver\.md$/i,
    /\.mcp-server\.md$/i,
    /^mcp-servers\/.+\.md$/i,
];

export function scanForMcpServerManifests(tree: TreeEntry[], explicitPath?: string): ManifestCandidate[] {
    if (explicitPath) {
        const hit = tree.find(e => e.path === explicitPath);
        return hit ? [{ path: hit.path, sha: hit.sha, size: hit.size }] : [];
    }
    return tree
        .filter(e => MCP_SERVER_MANIFEST_PATTERNS.some(re => re.test(e.path)))
        .map(e => ({ path: e.path, sha: e.sha, size: e.size }));
}

/**
 * 확장 매니페스트 후보 탐지 — plugin.json (Agent Plugins v1) + gemini-extension.json
 * (Gemini CLI 확장 — name/version/mcpServers 동형 스키마, 2026-08-16 실측 호환).
 *
 * 자동 탐지 규칙:
 *   1. 명시 explicitPath 지정 시 그것만
 *   2. tree 어디든 plugin.json / gemini-extension.json (root, 서브디렉토리, .claude-plugin/ 포함)
 */
const EXTENSION_MANIFEST_PATTERN = /(^|\/)(plugin|gemini-extension)\.json$/;

export function scanForExtensionManifests(tree: TreeEntry[], explicitPath?: string): ManifestCandidate[] {
    if (explicitPath) {
        const hit = tree.find(e => e.path === explicitPath);
        return hit ? [{ path: hit.path, sha: hit.sha, size: hit.size }] : [];
    }
    return tree
        .filter(e => EXTENSION_MANIFEST_PATTERN.test(e.path))
        .map(e => ({ path: e.path, sha: e.sha, size: e.size }));
}

/**
 * marketplace.json (Claude Code 마켓플레이스 인덱스) 탐지.
 * .claude-plugin/marketplace.json (표준) 또는 root marketplace.json.
 * root 에 가까운 순(경로 길이 오름차순)으로 정렬 — 첫 항목이 대표 인덱스.
 */
const MARKETPLACE_MANIFEST_PATTERN = /(^|\/)(\.claude-plugin\/)?marketplace\.json$/;

export function scanForMarketplaceManifests(tree: TreeEntry[]): ManifestCandidate[] {
    return tree
        .filter(e => MARKETPLACE_MANIFEST_PATTERN.test(e.path))
        .map(e => ({ path: e.path, sha: e.sha, size: e.size }))
        .sort((a, b) => a.path.length - b.path.length);
}

/**
 * plugin.json 경로 → 확장 루트 디렉토리 prefix ('' = repo root, 아니면 'dir/').
 * Claude Code 마켓플레이스 레이아웃(.claude-plugin/plugin.json)은 그 부모가 루트.
 */
/**
 * 확장 번들에서 **이 환경이 설치하지 않는 구성요소** 감지 (tree + 매니페스트 키).
 *
 * openmake_llm 은 스킬(SKILL.md)과 MCP 서버만 설치한다. Claude Code 플러그인의
 * commands/·agents/·hooks 나 Gemini/Qwen 의 contextFileName·excludeTools 는 대응
 * 개념이 없어 조용히 무시되던 것을, 설치 리포트로 드러내기 위한 스캔.
 *
 * @returns 사람이 읽는 라벨 목록 (예: ['슬래시 명령(commands/) 3개', '훅(hooks)'])
 */
export function detectUnsupportedComponents(
    entries: TreeEntry[],
    root: string,
    manifestRaw: Record<string, unknown> = {},
): string[] {
    const counts = new Map<string, number>();
    for (const e of entries) {
        if (root && !e.path.startsWith(root)) continue;
        const rel = root ? e.path.slice(root.length) : e.path;
        const seg = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : rel;
        // 디렉토리형 구성요소 (commands/foo.md, agents/bar.md, hooks/hooks.json)
        if (rel.includes('/') && seg in UNSUPPORTED_EXTENSION_COMPONENTS) {
            counts.set(seg, (counts.get(seg) ?? 0) + 1);
            continue;
        }
        // 파일형 (root 직하 hooks.json)
        if (rel === 'hooks.json') counts.set('hooks', (counts.get('hooks') ?? 0) + 1);
    }
    const notes: string[] = [];
    for (const [key, n] of counts) {
        notes.push(`${UNSUPPORTED_EXTENSION_COMPONENTS[key]} ${n}개`);
    }
    // 매니페스트 선언 키 (tree 에 파일이 없어도 선언만으로 감지)
    for (const key of Object.keys(manifestRaw)) {
        if (key in UNSUPPORTED_EXTENSION_COMPONENTS && !counts.has(key)) {
            notes.push(UNSUPPORTED_EXTENSION_COMPONENTS[key]);
        }
    }
    return notes;
}

export function resolveExtensionRoot(manifestPath: string): string {
    const dir = manifestPath.includes('/')
        ? manifestPath.slice(0, manifestPath.lastIndexOf('/'))
        : '';
    if (dir === '.claude-plugin') return '';
    if (dir.endsWith('/.claude-plugin')) return dir.slice(0, -'.claude-plugin'.length);
    return dir === '' ? '' : `${dir}/`;
}
