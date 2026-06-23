/**
 * ============================================================
 * Artifact Viewer Service — C안: 별도-오리진 엄격 CSP 정적 뷰어 export
 * ============================================================
 *
 * publish 된 artifact 를 self-contained HTML 로 빌드해 볼륨에 기록.
 * 별도 오리진 nginx 컨테이너가 strict CSP 로 서빙(외부요청 0).
 *
 * 보안 모델:
 *   - 별도 오리진 = 앱과 격리 (쿠키/스토리지 분리)
 *   - strict CSP: default-src 'none'; connect-src 'none' (네트워크 차단);
 *     script-src 'self' + (html 자체 인라인 스크립트는 sha256 해시 화이트리스트)
 *   - 라이브러리(mermaid/chart/react)는 뷰어 오리진에 self-host(/vendor) → 외부 CDN 0
 *   - react(JSX) 만 babel 런타임 변환 위해 'unsafe-eval' 추가 (해당 종류 한정)
 *
 * @module services/artifact-viewer-service
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { ARTIFACT_VIEWER, viewerArtifactDir } from '../config/artifact-viewer';
import { getPool } from '../data/models/unified-database';
import type { ArtifactVisibility, ArtifactPublicationRow } from '../data/repositories/artifact-publication-repository';
import type { ArtifactRow } from '../data/repositories/artifact-repository';
import { createLogger } from '../utils/logger';

const logger = createLogger('ArtifactViewer');

interface BuildInput {
    pubId: string;
    kind: string;
    lang: string | null;
    content: string;
    title: string;
    icon: string | null;
    author: string;
    version: number;
}

// ── HTML 이스케이프 ──────────────────────────────────────────
function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escJson(s: string): string {
    // </script> 조기 종료 + U+2028/2029 방지 (data island 안전 삽입)
    return s.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
/** CSP 해시 소스 — 스크립트 본문(소스 그대로)의 sha256-base64. */
function cspHash(scriptBody: string): string {
    return `'sha256-${createHash('sha256').update(scriptBody, 'utf8').digest('base64')}'`;
}

const CHROME_CSS = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a}
#__av_bar{position:sticky;top:0;z-index:2147483647;display:flex;align-items:center;gap:10px;
  padding:8px 14px;background:#0f172a;color:#f1f5f9;font-size:13px;border-bottom:1px solid #1e293b}
#__av_bar .t{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#__av_bar .m{color:#94a3b8;font-size:12px;white-space:nowrap}
#__av_bar .sp{flex:1}
#__av_bar a{color:#f1f5f9;text-decoration:none;background:#1e293b;padding:5px 11px;border-radius:6px;font-size:12px}
#__av_bar a:hover{background:#334155}
#__av_root{padding:16px}
`.trim();

/** 상단 chrome 바 (순수 HTML+CSS, JS 없음 → 해시 불필요). */
function chromeBar(input: BuildInput): string {
    const badge = input.lang ? `${escHtml(input.kind)}·${escHtml(input.lang)}` : escHtml(input.kind);
    const dl = `data:text/plain;charset=utf-8,` ; // 다운로드는 뷰어 페이지 자체 저장으로 안내(별도 raw 링크 생략)
    void dl;
    return `<div id="__av_bar">
  <span>${input.icon ? escHtml(input.icon) + ' ' : ''}</span>
  <span class="t">${escHtml(input.title)}</span>
  <span class="m">· ${badge} · v${input.version} · ${escHtml(input.author)}</span>
  <span class="sp"></span>
</div>`;
}

/**
 * 뷰어 오리진에 self-host 된 라이브러리 경로.
 * bootstrap.js(우리 코드)는 변경되므로 캐시버스팅 버전 부여 — /vendor 가 immutable 캐시라
 * 버전 없이는 갱신이 전파되지 않는다. bootstrap.js 수정 시 BOOTSTRAP_VERSION 을 올린다.
 */
const BOOTSTRAP_VERSION = '6';
const VENDOR = {
    bootstrap: `/vendor/bootstrap.js?v=${BOOTSTRAP_VERSION}`,
};

/**
 * 빌드 결과 — HTML 문자열 + 이 페이지가 react(unsafe-eval) 경로인지 여부.
 * react 는 nginx 의 완화 CSP location(/ra) 으로 서빙해야 하므로 분기 신호 반환.
 */
export interface BuiltViewer {
    html: string;
    needsUnsafeEval: boolean;
}

/**
 * code 아티팩트의 lang → 실제 렌더 종류 (프론트 previewKindFor 와 동일 규칙).
 * LLM 이 ```html 펜스로 출력하면 kind=code/lang=html 로 저장되므로 뷰어도 동일하게 매핑.
 */
const CODE_LANG_RENDER: Record<string, string> = {
    html: 'html', htm: 'html', svg: 'svg', mermaid: 'mermaid', mmd: 'mermaid', jsx: 'react', tsx: 'react',
};
function resolveRenderKind(kind: string, lang: string | null): string {
    if (kind === 'code' && lang) return CODE_LANG_RENDER[lang.toLowerCase().trim()] ?? 'code';
    return kind;
}

/**
 * publish 대상 artifact → self-contained 뷰어 HTML.
 *
 * - html  : 아티팩트 자체가 문서 → 인라인 스크립트 sha256 화이트리스트 + chrome 주입
 * - 그 외 : 우리 템플릿 + data island + vendored bootstrap('self') 렌더
 */
export function buildViewerHtml(input: BuildInput): BuiltViewer {
    const renderKind = resolveRenderKind(input.kind, input.lang);
    if (renderKind === 'html') return buildHtmlKind(input);
    return buildTemplatedKind({ ...input, kind: renderKind });
}

/** html 종류 — 아티팩트 문서에 chrome + 해시 CSP 주입. */
function buildHtmlKind(input: BuildInput): BuiltViewer {
    const raw = input.content;
    // 인라인 스크립트(<script> ... </script>, src 없는 것) 추출 → 해시
    const hashes: string[] = [];
    const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = SCRIPT_RE.exec(raw)) !== null) {
        hashes.push(cspHash(m[1]));
    }
    const scriptSrc = ["'self'", ...hashes].join(' ');
    const csp = cspContent(scriptSrc);
    const chromeStyle = `<style>${CHROME_CSS}</style>`;
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const bar = chromeBar(input);

    // <head> 에 meta+style 주입, <body> 직후 chrome 바 주입. 없으면 셸로 감쌈.
    let html = raw;
    if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (h) => `${h}\n${meta}\n${chromeStyle}`);
    } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, (h) => `${h}<head>${meta}${chromeStyle}</head>`);
    } else {
        html = `<!doctype html><html><head><meta charset="utf-8">${meta}${chromeStyle}</head><body>${html}</body></html>`;
    }
    if (/<body[^>]*>/i.test(html)) {
        html = html.replace(/<body[^>]*>/i, (b) => `${b}\n${bar}`);
    } else {
        html = html.replace(/<\/head>/i, `</head><body>${bar}`);
    }
    return { html, needsUnsafeEval: false };
}

/** 그 외 종류 — 템플릿 + data island + vendored bootstrap. */
function buildTemplatedKind(input: BuildInput): BuiltViewer {
    const needsUnsafeEval = input.kind === 'react' && ARTIFACT_VIEWER.reactNeedsUnsafeEval;
    const scriptSrcParts = ["'self'"];
    if (needsUnsafeEval) scriptSrcParts.push("'unsafe-eval'");
    const csp = cspContent(scriptSrcParts.join(' '));

    const dataIsland = `<script type="application/json" id="__av_data">${escJson(JSON.stringify({
        kind: input.kind,
        lang: input.lang,
        content: input.content,
    }))}</script>`;

    const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${input.icon ? escHtml(input.icon) + ' ' : ''}${escHtml(input.title)}</title>
<style>${CHROME_CSS}</style>
</head>
<body>
${chromeBar(input)}
<div id="__av_root"></div>
${dataIsland}
<script src="${VENDOR.bootstrap}"></script>
</body>
</html>`;
    return { html, needsUnsafeEval };
}

/** strict CSP 본문 — scriptSrc 만 종류별로 다름. */
function cspContent(scriptSrc: string): string {
    return [
        "default-src 'none'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "media-src data:",
        "connect-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    ].join('; ');
}

// ── 파일 export ──────────────────────────────────────────────

/**
 * publish → 뷰어 디렉토리에 index.html 기록.
 * script-src(해시/'self'/react 'unsafe-eval')는 전부 페이지 <meta> CSP 가 전담하므로
 * nginx 는 frame-ancestors 등 header-only 항목만 추가하면 된다(종류별 분기 불필요).
 */
export async function exportPublication(input: BuildInput): Promise<void> {
    const dir = viewerArtifactDir(input.pubId);
    await fs.mkdir(dir, { recursive: true });
    const built = buildViewerHtml(input);
    await fs.writeFile(`${dir}/index.html`, built.html, 'utf8');
    logger.info(`뷰어 export: pub=${input.pubId} kind=${input.kind} unsafeEval=${built.needsUnsafeEval}`);
}

/** unpublish → 뷰어 디렉토리 제거. */
export async function removePublication(pubId: string): Promise<void> {
    await fs.rm(viewerArtifactDir(pubId), { recursive: true, force: true });
    logger.info(`뷰어 제거: pub=${pubId}`);
}

/** 작성자 표시명 (username 우선, 없으면 email 앞부분). */
export async function resolveAuthorLabel(ownerUserId: string): Promise<string> {
    const r = await getPool().query<{ username: string | null; email: string | null }>(
        'SELECT username, email FROM users WHERE id = $1',
        [ownerUserId],
    );
    const row = r.rows[0];
    if (!row) return 'Unknown';
    return row.username || (row.email ? row.email.split('@')[0] : 'Unknown');
}

/** publish 된 artifact 의 노출 버전(shared_version ?? 최신)을 self-contained HTML 로 export. */
export async function exportPublicationViewer(pub: ArtifactPublicationRow, versions: ArtifactRow[]): Promise<void> {
    if (!ARTIFACT_VIEWER.enabled || versions.length === 0) return;
    const target = (pub.shared_version != null
        ? versions.find(v => v.version === pub.shared_version)
        : versions[versions.length - 1]) ?? versions[versions.length - 1];
    const author = await resolveAuthorLabel(pub.owner_user_id);
    await exportPublication({
        pubId: pub.publication_id,
        kind: target.kind,
        lang: target.language,
        content: target.content,
        title: pub.title || target.title,
        icon: pub.icon,
        author,
        version: target.version,
    });
}

/** 공유용 안정 URL — link visibility 만 토큰 포함 stable URL. 그 외는 /open 으로 per-user 발급. */
export function composeShareUrl(pub: ArtifactPublicationRow): string | null {
    if (pub.visibility === 'link' && pub.share_token) {
        return `${ARTIFACT_VIEWER.origin}/a/${pub.publication_id}/?k=${encodeURIComponent(pub.share_token)}`;
    }
    return null;
}

// ── 접근토큰 (authenticated/private) — HMAC, 쿠키 교차오리진 회피 ──

/** `{pubId}.{expEpoch}.{sig}` 형식 단기 토큰. 앱이 쿠키인증 후 발급, nginx auth_request 가 검증. */
export function mintAccessToken(pubId: string): string {
    const exp = Math.floor(Date.now() / 1000) + ARTIFACT_VIEWER.accessTokenTtlSec;
    const payload = `${pubId}.${exp}`;
    const sig = createHmac('sha256', ARTIFACT_VIEWER.signingKey).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

/** 접근토큰 검증 — pubId 일치 + 미만료 + 서명일치. */
export function verifyAccessToken(pubId: string, token: string): boolean {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [tokPub, expStr, sig] = parts;
    if (tokPub !== pubId) return false;
    const exp = parseInt(expStr, 10);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = createHmac('sha256', ARTIFACT_VIEWER.signingKey).update(`${tokPub}.${expStr}`).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 뷰어 접근 인가 판정 (nginx auth_request 백엔드용).
 * @returns 허용 여부
 */
export function authorizeViewer(opts: {
    visibility: ArtifactVisibility;
    shareToken: string | null;
    pubId: string;
    providedToken: string;
}): boolean {
    if (opts.visibility === 'link') {
        return !!opts.shareToken && !!opts.providedToken && opts.providedToken === opts.shareToken;
    }
    // authenticated / private → 앱이 발급한 서명 접근토큰
    return verifyAccessToken(opts.pubId, opts.providedToken);
}
