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
