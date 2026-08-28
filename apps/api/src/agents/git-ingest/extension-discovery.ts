/**
 * 확장 구성요소 탐지 — 카탈로그 **판정**(catalog-snapshot)과 **설치**(extension-ingest-service)가
 * 같은 함수를 쓰게 하는 순수 모듈 (2026-08-29).
 *
 * 배경: 판정(`probeInstallableAt` — skills 디렉토리 존재만 봄)과 설치(plugin.json 스키마·경로)가
 * 따로 있어 "installable=true 인데 설치는 실패" 가 815건 중 34건 나왔다. 여기서 한 번만 정의하고
 * 양쪽이 호출한다. 상류 규격(Claude Code plugin.json) 이 허용하는 형태를 그대로 받는다:
 *   - 매니페스트: .claude-plugin/plugin.json > plugin.json > gemini-extension.json.
 *     **plugin.json 은 선택** — marketplace 엔트리 메타(name/description)로 합성한다
 *     (공식 마켓의 receipts·session-report·anthropics/skills 가 이 형태).
 *   - `skills`: 기본 `skills/<dir>/SKILL.md` + plugin.json `skills` 경로 필드(문자열/배열) +
 *     둘 다 없으면 루트 직하 `<dir>/SKILL.md` (마켓 path 가 스킬 컨테이너 자체인 amd/coursera).
 *   - `mcpServers`: 객체 또는 **파일 경로 문자열**(`"./.mcp.json"`), 없으면 루트 mcp.json/.mcp.json.
 *
 * @module agents/git-ingest/extension-discovery
 */
import type { ExtensionManifest } from './extension-manifest-validator';

/** tree 엔트리 최소 형태 — git-fetcher 의 TreeEntry 와 extension-components 의 TreeLike 둘 다 만족 */
export type PathEntry = { path: string };

/**
 * 합성 매니페스트의 가상 경로 basename — 실제 파일이 없다. `user_extensions.source_path` 에
 * 이 경로가 남으면 "마켓 엔트리로 합성된 설치" 라는 뜻이며, 재설치(갤러리) 시
 * `isSynthesizedManifestPath` 로 분기한다.
 */
export const SYNTHESIZED_MANIFEST_BASENAME = '.claude-plugin/marketplace-entry.json';

export function synthesizedManifestPath(root: string): string {
    return `${root}${SYNTHESIZED_MANIFEST_BASENAME}`;
}

export function isSynthesizedManifestPath(path: string): boolean {
    return path === SYNTHESIZED_MANIFEST_BASENAME || path.endsWith(`/${SYNTHESIZED_MANIFEST_BASENAME}`);
}

/** 합성 경로 → 확장 루트 prefix ('' 또는 'dir/'). */
export function rootOfSynthesizedPath(path: string): string {
    return path.slice(0, path.length - SYNTHESIZED_MANIFEST_BASENAME.length);
}

/** 확장 루트(prefix, '' 또는 'dir/') 의 매니페스트 경로 — 우선순위 고정. 없으면 undefined. */
export function findExtensionManifestPath(entries: readonly PathEntry[], root: string): string | undefined {
    for (const candidate of [`${root}.claude-plugin/plugin.json`, `${root}plugin.json`, `${root}gemini-extension.json`]) {
        if (entries.some(e => e.path === candidate)) return candidate;
    }
    return undefined;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 확장 루트 기준 SKILL.md 기본 탐지 패턴 (순수 함수 — 테스트용 export).
 * 매칭: skills/<dir>/SKILL.md (Agent Plugins v1) · skill/SKILL.md (Qwen-MM-Plugins 등
 * 단수 레이아웃) · skills/SKILL.md. 하위 디렉토리 중첩은 1단계까지만.
 */
export function buildSkillDiscoveryPattern(root: string): RegExp {
    return new RegExp(`^${escapeRegExp(root)}skills?/(?:[^/]+/)?SKILL\\.md$`, 'i');
}

/**
 * 매니페스트의 상대 경로를 루트 아래 tree 경로로 정규화. `./` 제거, 끝 `/` 제거, `..` 는 거부(null).
 * 결과는 항상 root 로 시작한다 (루트 밖 탈출 차단).
 */
export function resolveUnderRoot(root: string, relative: string): string | null {
    const cleaned = relative.trim().replace(/^\.\//, '').replace(/\/+$/, '').replace(/^\/+/, '');
    if (cleaned === '' || cleaned === '.') return root.replace(/\/$/, '');
    if (cleaned.split('/').some(seg => seg === '..')) return null;
    return `${root}${cleaned}`;
}

/**
 * SKILL.md 경로 탐지 — 기본 레이아웃 + plugin.json `skills` 필드 + 루트 컨테이너 폴백.
 * 순서 보존·중복 제거. 상한(maxSkillsPerExtension) 적용은 호출측.
 */
export function discoverSkillPaths(entries: readonly PathEntry[], root: string, skillPathsField: string[] = []): string[] {
    const found: string[] = [];
    const defaultPattern = buildSkillDiscoveryPattern(root);
    for (const e of entries) if (defaultPattern.test(e.path)) found.push(e.path);

    for (const field of skillPathsField) {
        const base = resolveUnderRoot(root, field);
        if (base === null) continue;
        const direct = base === '' ? 'SKILL.md' : `${base}/SKILL.md`;
        if (entries.some(e => e.path === direct)) { found.push(direct); continue; }
        const childPattern = new RegExp(`^${escapeRegExp(base === '' ? '' : `${base}/`)}[^/]+/SKILL\\.md$`, 'i');
        for (const e of entries) if (childPattern.test(e.path)) found.push(e.path);
    }

    // 루트 자체가 스킬 컨테이너 (마켓 엔트리 path 가 `skills/` 를 가리키는 amd/coursera 레이아웃)
    if (found.length === 0) {
        const containerPattern = new RegExp(`^${escapeRegExp(root)}[^/]+/SKILL\\.md$`, 'i');
        for (const e of entries) if (containerPattern.test(e.path)) found.push(e.path);
    }
    return [...new Set(found)];
}

/**
 * `<root><dir>/**.md` (1단계 중첩까지) + 매니페스트 경로 필드. commands/·agents/ 공용.
 */
export function discoverMarkdownComponents(
    entries: readonly PathEntry[],
    root: string,
    dirName: string,
    fieldPaths: string[] = [],
): string[] {
    const pattern = new RegExp(`^${escapeRegExp(root)}${dirName}/(?:[^/]+/)?[^/]+\\.md$`, 'i');
    const found = entries.filter(e => pattern.test(e.path)).map(e => e.path);
    for (const field of fieldPaths) {
        const resolved = resolveUnderRoot(root, field);
        if (resolved === null) continue;
        if (resolved.toLowerCase().endsWith('.md')) {
            if (entries.some(e => e.path === resolved)) found.push(resolved);
            continue;
        }
        const childPattern = new RegExp(`^${escapeRegExp(resolved === '' ? '' : `${resolved}/`)}(?:[^/]+/)?[^/]+\\.md$`, 'i');
        for (const e of entries) if (childPattern.test(e.path)) found.push(e.path);
    }
    return [...new Set(found)];
}

/**
 * MCP 설정 파일 경로 — plugin.json `mcpServers` 가 문자열이면 그 경로, 아니면 루트 mcp.json/.mcp.json.
 * 파일이 tree 에 없으면 undefined (문자열 경로가 가리키는 파일이 상류에 없는 kobiton 실사례 포함).
 */
export function findMcpConfigPath(entries: readonly PathEntry[], root: string, mcpServersPath?: string): string | undefined {
    if (mcpServersPath) {
        const resolved = resolveUnderRoot(root, mcpServersPath);
        return resolved && entries.some(e => e.path === resolved) ? resolved : undefined;
    }
    for (const candidate of [`${root}mcp.json`, `${root}.mcp.json`]) {
        if (entries.some(e => e.path === candidate)) return candidate;
    }
    return undefined;
}

/**
 * 설치 가능 판정 — 설치 경로(6-a~6-c)가 찾을 구성요소가 하나라도 있는가.
 * 매니페스트가 없는(합성) 경우 manifest=null. tree 기반이라 SKILL.md 본문 검증은 하지 않는다
 * (그 실패는 설치 리포트의 부분 실패로 노출).
 */
export function hasInstallableComponents(
    entries: readonly PathEntry[],
    root: string,
    manifest: Pick<ExtensionManifest, 'mcpServers' | 'mcpServersPath' | 'skillPaths' | 'commandPaths'> | null,
): boolean {
    if (manifest && manifest.mcpServers.length > 0) return true;
    if (discoverSkillPaths(entries, root, manifest?.skillPaths).length > 0) return true;
    if (discoverMarkdownComponents(entries, root, 'commands', manifest?.commandPaths).length > 0) return true;
    if (discoverMarkdownComponents(entries, root, 'agents').length > 0) return true;
    return findMcpConfigPath(entries, root, manifest?.mcpServersPath) !== undefined;
}
