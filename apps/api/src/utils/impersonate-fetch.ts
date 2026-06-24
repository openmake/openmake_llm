/**
 * ============================================================
 * Impersonate Fetch — TLS fingerprint 임퍼소네이션 (차단 우회, 2단계)
 * ============================================================
 * Reddit 등 TLS(JA3) fingerprint 로 봇을 차단하는 사이트는 Node fetch/undici 로
 * 우회 불가하다. Python `curl_cffi`(브라우저 TLS 임퍼소네이션)를 child_process 로
 * 호출해 공개 엔드포인트(.json 등)에 접근한다. (doc-extractor 의 child_process 패턴 동형)
 *
 * **보안(SSRF) 정합** — curl_cffi 는 별도 프로세스라 safeFetch 의 SSRF 가드를 우회하므로:
 *   1. 도메인 화이트리스트(SCRAPER_CONFIG.IMPERSONATE_WHITELIST)에만 허용
 *   2. DNS resolve 후 차단 IP 대역(isBlockedIP) 거부
 *   3. resolve 한 공인 IP 를 curl `--resolve` 로 고정 → DNS rebinding 차단
 *   4. allow_redirects=False → 단일 hop (리다이렉트로 내부망 우회 방지)
 *
 * 기본 OFF(SCRAPER_CONFIG.IMPERSONATE_ENABLED). curl_cffi 미설치 시 graceful null.
 *
 * @module utils/impersonate-fetch
 */
import { execFile } from 'child_process';
import dns from 'node:dns/promises';
import { isBlockedIP } from '../security/ssrf-guard';
import { SCRAPER_CONFIG } from '../config/web-scraper';
import { createLogger } from './logger';

const logger = createLogger('ImpersonateFetch');

/** python 스크립트를 stdin 으로 payload 를 넘겨 실행하고 stdout 을 반환 (execFile 은 input 옵션 미지원). */
function runPython(payload: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            SCRAPER_CONFIG.PYTHON_BIN,
            ['-c', PY_SCRIPT],
            {
                timeout: SCRAPER_CONFIG.IMPERSONATE_TIMEOUT_MS + 5000,
                maxBuffer: SCRAPER_CONFIG.IMPERSONATE_MAX_BYTES + 1_000_000,
            },
            (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout);
            },
        );
        child.stdin?.end(payload);
    });
}

/** stdin 으로 받은 설정으로 curl_cffi GET 을 수행하는 파이썬 스크립트 (인자는 stdin JSON — 셸 인젝션 차단) */
const PY_SCRIPT = `
import sys, json
data = json.load(sys.stdin)
try:
    from curl_cffi import requests
except Exception:
    print(json.dumps({"error": "curl_cffi_not_installed"})); sys.exit(0)
try:
    r = requests.get(
        data["url"],
        impersonate=data["target"],
        allow_redirects=False,
        timeout=data["timeout"],
        resolve=[data["resolve"]],
        headers={"Accept-Language": "en-US,en;q=0.9"},
    )
    body = r.text
    if len(body) > data["maxBytes"]:
        body = body[: data["maxBytes"]]
    print(json.dumps({"status": r.status_code, "body": body}))
except Exception as e:
    print(json.dumps({"error": str(e)[:300]}))
`;

export interface ImpersonateResult {
    status: number;
    body: string;
}

/**
 * curl_cffi 로 차단 우회 GET. 비활성/비화이트리스트/차단IP/미설치 시 null (graceful).
 */
export async function impersonateFetch(rawUrl: string): Promise<ImpersonateResult | null> {
    if (!SCRAPER_CONFIG.IMPERSONATE_ENABLED) return null;

    let u: URL;
    try {
        u = new URL(rawUrl);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

    // 1. 화이트리스트 도메인만
    if (!SCRAPER_CONFIG.IMPERSONATE_WHITELIST.includes(u.hostname.toLowerCase())) {
        logger.warn(`[impersonate] 비화이트리스트 도메인 거부: ${u.hostname}`);
        return null;
    }

    // 2. DNS resolve + 차단 IP 거부, 3. 고정 IP 확보
    let address: string;
    try {
        ({ address } = await dns.lookup(u.hostname));
    } catch {
        return null;
    }
    if (isBlockedIP(address)) {
        logger.warn(`[impersonate] 차단 IP 대역 거부: ${u.hostname} → ${address}`);
        return null;
    }
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');

    const payload = JSON.stringify({
        url: rawUrl,
        target: SCRAPER_CONFIG.IMPERSONATE_TARGET,
        timeout: Math.ceil(SCRAPER_CONFIG.IMPERSONATE_TIMEOUT_MS / 1000),
        maxBytes: SCRAPER_CONFIG.IMPERSONATE_MAX_BYTES,
        // curl --resolve host:port:ip 로 DNS rebinding 차단 (검증한 IP 로만 연결)
        resolve: `${u.hostname}:${port}:${address}`,
    });

    try {
        const stdout = await runPython(payload);
        const out = JSON.parse(stdout.trim());
        if (out.error) {
            if (out.error === 'curl_cffi_not_installed') {
                logger.warn('[impersonate] curl_cffi 미설치 — `pip install curl_cffi` 필요');
            } else {
                logger.warn(`[impersonate] 실패: ${out.error}`);
            }
            return null;
        }
        return { status: out.status, body: out.body };
    } catch (e) {
        logger.warn(`[impersonate] child_process 실패: ${e instanceof Error ? e.message : e}`);
        return null;
    }
}
