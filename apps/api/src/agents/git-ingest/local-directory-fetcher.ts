/**
 * 로컬 디렉터리 페처 — `local://<상대경로>` 소스를 서버 파일시스템에서 읽는다 (2026-09-19, S3 에어갭 설치).
 *
 * GitFetcher 동형(duck-typed)이라 git·zip 과 같은 파이프라인(매니페스트 검증 → 구성요소 변환 → draft → 승인)을
 * 그대로 탄다. ref 개념이 없어 내용 해시를 sha 로 쓴다(ArchiveFetcher 와 같은 모델).
 *
 * 🔒 보안 — 이 페처는 **서버의 파일시스템을 읽는다**:
 *   ① 루트가 설정돼 있을 때만 동작한다(`ADDON_LOCAL_INSTALL_ROOT` 미설정 = 기능 off).
 *   ② 경로는 realpath 로 풀어 루트 안인지 확인한다 — 심링크 탈출·`..` 차단(어휘적 resolve 로는 못 막는다).
 *   ③ 호출부가 **관리자만** 쓰게 막는다(`extension-ingest-service`) — 임의 경로 읽기를 사용자에게 열지 않는다.
 *   ④ 엔트리 수·총 크기 상한으로 거대한 트리를 거른다.
 *
 * @module agents/git-ingest/local-directory-fetcher
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { TreeEntry, TreeResult } from './git-fetcher';
import { createLogger } from '../../utils/logger';

const logger = createLogger('LocalDirectoryFetcher');

export const LOCAL_SOURCE_PREFIX = 'local://';

export function isLocalSourceUrl(url: string): boolean {
    return url.trim().startsWith(LOCAL_SOURCE_PREFIX);
}

export function localSourceRelPath(url: string): string {
    return url.trim().slice(LOCAL_SOURCE_PREFIX.length).replace(/^\/+/, '');
}

export function localPseudoRepo(url: string): { owner: string; repo: string } {
    const rel = localSourceRelPath(url) || 'root';
    return { owner: 'local', repo: rel.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80) || 'root' };
}

export interface LocalFetcherLimits {
    /** 허용 루트(절대경로). 빈 값이면 기능 off */
    root: string;
    maxEntries: number;
    maxTotalBytes: number;
}

/**
 * PURE-ish: 요청 경로를 루트 안의 실제 경로로 푼다. 루트 밖이거나 존재하지 않으면 throw.
 * realpath 기반이라 심링크로 루트를 벗어나는 경로도 막힌다.
 */
export function resolveLocalSourceDir(url: string, root: string): string {
    if (!root) throw new Error('LOCAL_SOURCE_DISABLED: ADDON_LOCAL_INSTALL_ROOT 미설정');
    const realRoot = fs.realpathSync(root);
    const target = path.resolve(realRoot, localSourceRelPath(url));
    let realTarget: string;
    try {
        realTarget = fs.realpathSync(target);
    } catch {
        throw new Error(`LOCAL_SOURCE_NOT_FOUND: ${url}`);
    }
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
        throw new Error(`LOCAL_SOURCE_OUT_OF_ROOT: ${url}`);
    }
    if (!fs.statSync(realTarget).isDirectory()) throw new Error(`LOCAL_SOURCE_NOT_DIR: ${url}`);
    return realTarget;
}

export class LocalDirectoryFetcher {
    private loaded: { sha: string; files: Map<string, Buffer> } | null = null;

    constructor(private url: string, private limits: LocalFetcherLimits) {}

    private load(): { sha: string; files: Map<string, Buffer> } {
        if (this.loaded) return this.loaded;
        const dir = resolveLocalSourceDir(this.url, this.limits.root);
        const files = new Map<string, Buffer>();
        let total = 0;
        const walk = (cur: string, rel: string): void => {
            for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
                // 심링크는 따라가지 않는다 — 루트 밖을 가리킬 수 있다(realpath 검사로도 트리 순회 중엔 놓칠 수 있다).
                if (entry.isSymbolicLink()) continue;
                if (entry.name === '.git' || entry.name === 'node_modules') continue;
                const abs = path.join(cur, entry.name);
                const relPath = rel ? `${rel}/${entry.name}` : entry.name;
                if (entry.isDirectory()) { walk(abs, relPath); continue; }
                if (!entry.isFile()) continue;
                const data = fs.readFileSync(abs);
                total += data.byteLength;
                if (total > this.limits.maxTotalBytes) throw new Error(`LOCAL_SOURCE_TOO_LARGE: > ${this.limits.maxTotalBytes}`);
                files.set(relPath, data);
                if (files.size > this.limits.maxEntries) throw new Error(`LOCAL_SOURCE_TOO_MANY_ENTRIES: > ${this.limits.maxEntries}`);
            }
        };
        walk(dir, '');
        if (files.size === 0) throw new Error(`LOCAL_SOURCE_EMPTY: ${this.url}`);
        // 내용 해시 = 업데이트 판정 기준(ref 가 없다)
        const hash = crypto.createHash('sha256');
        for (const key of [...files.keys()].sort()) {
            hash.update(key).update(files.get(key)!);
        }
        const sha = hash.digest('hex');
        logger.info(`local source loaded: ${this.url} (${files.size} files, ${total}B, sha=${sha.slice(0, 8)})`);
        this.loaded = { sha, files };
        return this.loaded;
    }

    /** GitFetcher 동형 — ref 는 무시하고 내용 해시를 돌려준다. */
    async resolveRef(_owner: string, _repo: string, _ref?: string): Promise<string> {
        return this.load().sha;
    }

    /** GitFetcher 동형 — 디렉터리 트리. */
    async listTree(_owner: string, _repo: string, _sha: string, maxEntries: number = 10_000): Promise<TreeResult> {
        const { sha, files } = this.load();
        const entries: TreeEntry[] = [];
        for (const [p, data] of files) {
            entries.push({ path: p, sha: '', size: data.byteLength, type: 'blob' });
            if (entries.length > maxEntries) throw new Error(`LOCAL_SOURCE_TOO_MANY_ENTRIES: > ${maxEntries}`);
        }
        return { sha, entries, truncated: false, rateLimitRemaining: -1 };
    }

    /** GitFetcher 동형 — 파일 텍스트. */
    async fetchFile(_owner: string, _repo: string, _sha: string, p: string, maxBytes?: number): Promise<string> {
        const { files } = this.load();
        const data = files.get(p);
        if (!data) throw new Error(`LOCAL_SOURCE_FILE_NOT_FOUND: ${p}`);
        if (maxBytes && data.byteLength > maxBytes) {
            throw new Error(`LOCAL_SOURCE_FILE_TOO_LARGE: ${p} (${data.byteLength} > ${maxBytes})`);
        }
        return data.toString('utf-8');
    }
}
