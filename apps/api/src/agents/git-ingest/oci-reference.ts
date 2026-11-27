/**
 * OCI 원본 참조 파싱 — `oci://<registry>/<repository>(:<tag>|@sha256:<digest>)` (P8, opt-in EXTENSION_OCI_INSTALL_ENABLED).
 *
 * 순수 함수. 설치 엔진(oci-fetcher)·원본 정책(source-policy)이 **같은 파서**로 원본을 식별한다 — 정책을 통과한
 * 이름과 실제로 내려받는 이름이 어긋나지 않게(정규화 우회 차단).
 *
 * 정규화·거절 규칙(관대하게 고치지 않고 **거절**한다 — 고친 값이 정책 비교를 우회하는 통로가 되지 않게):
 *   - 레지스트리: 호스트 소문자, 기본 포트 `:443` 제거. userinfo·쿼리·프래그먼트·퍼센트 인코딩·백슬래시는 거절.
 *     `.`·`:` 이 없고 `localhost` 도 아니면 레지스트리 호스트로 보지 않는다(Docker 축약형 `oci://org/repo` 는 거절).
 *   - Docker Hub 별칭(docker.io·index.docker.io·registry-1.docker.io) → 정규 이름 `docker.io`, 단일 이름 저장소는
 *     `library/<name>`(Docker 공식 이미지 규칙). 실제 API 호스트는 registry-1.docker.io.
 *   - 저장소: OCI Distribution 사양 문법(소문자만, 구성요소 `[a-z0-9]+([._]|__|-+)[a-z0-9]+`). 대문자·`..`·빈 구성요소는 거절.
 *   - 참조: 태그 `[A-Za-z0-9_][A-Za-z0-9._-]{0,127}` 또는 `sha256:<64 hex 소문자>`. 생략하면 `latest`.
 *
 * @module agents/git-ingest/oci-reference
 */
import * as crypto from 'crypto';
import { OCI_DOCKER_HUB, OCI_SOURCE_PREFIX, extensionOciInstallEnabled } from '../../config/extension-oci';

export interface OciReference {
    /** 정책 비교용 레지스트리(host[:port], 소문자, :443 제거, Docker Hub 별칭 → docker.io) */
    registry: string;
    /** 실제 API 호스트(host[:port]) */
    apiHost: string;
    /** 저장소 경로(소문자) */
    repository: string;
    /** 태그(digest 참조면 undefined) */
    tag?: string;
    /** 고정 digest(`sha256:<hex>`) — URL 에 digest 로 지정했을 때 */
    digest?: string;
    /** 정규화된 원본 URL(`oci://registry/repository[:tag|@digest]`) */
    url: string;
}

const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
export const OCI_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const REPO_COMPONENT_RE = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const MAX_REPOSITORY_CHARS = 255;

/** PURE: `oci://` 스킴인지(문법 검사 전). 플래그 판정은 호출부(isEnabledOciSourceUrl) */
export function hasOciScheme(url: string): boolean {
    return url.trim().toLowerCase().startsWith(OCI_SOURCE_PREFIX);
}

/**
 * `oci://` 원본으로 다룰지 — 플래그(EXTENSION_OCI_INSTALL_ENABLED)가 켜져 있을 때만. 꺼져 있으면 false 라
 * 설치 엔진·원본 정책이 종전처럼 git URL 로 판정한다(= INVALID_GIT_URL 거절, 동작 불변).
 */
export function isEnabledOciSourceUrl(url: string): boolean {
    return hasOciScheme(url) && extensionOciInstallEnabled();
}

/** PURE: 레지스트리 문자열 정규화 — 실패 시 null */
export function normalizeOciRegistry(raw: string): { registry: string; apiHost: string } | null {
    const r = raw.trim().toLowerCase();
    const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(r);
    if (!m) return null;
    const host = m[1];
    const port = m[2];
    if (!HOST_RE.test(host)) return null;
    if (port !== undefined) {
        const n = Number(port);
        if (n < 1 || n > 65535 || String(n) !== port) return null;
    }
    if (!host.includes('.') && host !== 'localhost' && port === undefined) return null;
    const hostPort = port && port !== '443' ? `${host}:${port}` : host;
    if ((OCI_DOCKER_HUB.aliases as readonly string[]).includes(hostPort)) {
        return { registry: OCI_DOCKER_HUB.canonical, apiHost: OCI_DOCKER_HUB.apiHost };
    }
    return { registry: hostPort, apiHost: hostPort };
}

/** PURE: 저장소 경로 검증(사양 문법) */
export function isValidOciRepository(repo: string): boolean {
    if (!repo || repo.length > MAX_REPOSITORY_CHARS) return false;
    return repo.split('/').every((c) => REPO_COMPONENT_RE.test(c));
}

/** PURE: `oci://` 참조 파싱. 문법이 맞지 않으면 null(설치 엔진은 INVALID_OCI_REFERENCE 로 거절) */
export function parseOciReference(raw: string): OciReference | null {
    const trimmed = raw.trim();
    if (!hasOciScheme(trimmed)) return null;
    const rest = trimmed.slice(OCI_SOURCE_PREFIX.length);
    // 우회 통로가 될 문자는 고치지 않고 거절한다
    if (!rest || /[\s?#%\\@]/.test(rest.replace(/@sha256:[a-f0-9]{64}$/, ''))) return null;
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const reg = normalizeOciRegistry(rest.slice(0, slash));
    if (!reg) return null;
    let path = rest.slice(slash + 1);
    let tag: string | undefined;
    let digest: string | undefined;
    const at = path.indexOf('@');
    if (at >= 0) {
        digest = path.slice(at + 1);
        path = path.slice(0, at);
        if (!OCI_DIGEST_RE.test(digest)) return null;
    } else {
        const lastSlash = path.lastIndexOf('/');
        const colon = path.indexOf(':', lastSlash + 1);
        if (colon >= 0) {
            tag = path.slice(colon + 1);
            path = path.slice(0, colon);
            if (!TAG_RE.test(tag)) return null;
        } else {
            tag = 'latest';
        }
    }
    let repository = path;
    if (reg.registry === OCI_DOCKER_HUB.canonical && repository && !repository.includes('/')) {
        repository = `${OCI_DOCKER_HUB.officialNamespace}/${repository}`;
    }
    if (!isValidOciRepository(repository)) return null;
    const ref = digest ? `@${digest}` : `:${tag}`;
    return { registry: reg.registry, apiHost: reg.apiHost, repository, ...(tag ? { tag } : {}), ...(digest ? { digest } : {}), url: `${OCI_SOURCE_PREFIX}${reg.registry}/${repository}${ref}` };
}

/** PURE: GitFetcher 동형 pseudo owner/repo — OciFetcher 는 인자를 무시하므로 식별용 안정 값만 */
export function ociPseudoRepo(url: string): { owner: string; repo: string } {
    const hash = crypto.createHash('sha256').update(url.trim()).digest('hex').slice(0, 12);
    return { owner: 'oci', repo: hash };
}
