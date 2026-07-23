/**
 * ============================================================
 * Auth OAuth Helpers
 * ============================================================
 * auth-oauth.controller.ts에서 분리된 OAuth 공용 헬퍼.
 * OAuth state 저장/검증(CSRF 방어), redirect URI 생성, 성공 리다이렉트를 담당합니다.
 */

import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config/env';

const log = createLogger('AuthOAuthHelpers');

// 🔒 Phase 2 보안 패치 2026-02-07: OAuth State 저장소 (CSRF 방어용)
// 🔒 Phase 3 패치 2026-02-13: 인메모리 Map → DB 저장으로 변경 (클러스터/재시작 안전)
// PostgreSQL을 사용하여 프로세스 간 공유 가능, 서버 재시작에도 유지됨
const STATE_TTL_MS = Number(process.env.OAUTH_STATE_TTL_MS) || 5 * 60 * 1000; // 기본 5분
const STATE_CLEANUP_INTERVAL_MS = Number(process.env.OAUTH_STATE_CLEANUP_INTERVAL_MS) || 60 * 1000; // 기본 60초

// 인메모리 폴백: DB 연결 실패 시 임시 사용 (단일 프로세스 한정)
const oauthStatesFallback = new Map<string, { provider: string; createdAt: number }>();

/**
 * DB 기반 OAuth state 저장소 헬퍼 (안전 폴백)
 *
 * 주 DDL은 db/init/002-schema.sql에서 관리합니다.
 * 이 함수는 스키마 마이그레이션 없이 서버를 시작한 경우를 위한 안전 폴백입니다.
 */
async function ensureOauthStateTable(): Promise<void> {
    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
    } catch (e) {
        log.warn('[OAuth] oauth_states 테이블 생성 실패 (폴백 사용):', e);
    }
}

// 서버 시작 시 테이블 생성 + 만료 state 정리 스케줄러
ensureOauthStateTable();
let oauthCleanupInFlight = false;
const oauthCleanupTimer = setInterval(() => {
    if (oauthCleanupInFlight) {
        return;
    }

    oauthCleanupInFlight = true;

    void (async () => {
        try {
            const { getPool } = await import('../data/models/unified-database');
            const pool = getPool();
            await pool.query(
                `DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '5 minutes'`
            );
        } catch {
            // DB 연결 실패 시 폴백 정리
            const now = Date.now();
            for (const [state, data] of oauthStatesFallback.entries()) {
                if (now - data.createdAt > STATE_TTL_MS) {
                    oauthStatesFallback.delete(state);
                }
            }
        } finally {
            oauthCleanupInFlight = false;
        }
    })();
}, STATE_CLEANUP_INTERVAL_MS);
// BUG-R3-002: unref() - 타이머가 프로세스 종료를 막지 않도록 설정
if ((oauthCleanupTimer as NodeJS.Timeout & { unref?: () => void }).unref) {
    (oauthCleanupTimer as NodeJS.Timeout & { unref: () => void }).unref();
}

/**
 * OAuth state 정리 스케줄러 중지 (서버 종료 시)
 */
export function stopOAuthCleanup(): void {
    clearInterval(oauthCleanupTimer);
}

/**
 * 🔒 보안 강화된 OAuth state 생성 (DB 저장)
 */
export async function generateSecureState(provider: string): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        await pool.query(
            'INSERT INTO oauth_states (state, provider) VALUES ($1, $2)',
            [state, provider]
        );
    } catch (e) {
        log.warn('[OAuth] DB state 저장 실패, 인메모리 폴백 사용:', e);
        oauthStatesFallback.set(state, { provider, createdAt: Date.now() });
    }
    return state;
}

/**
 * 🔒 OAuth state 검증 및 소비 (일회성, DB 기반)
 */
export async function validateAndConsumeState(state: string | undefined, expectedProvider: string): Promise<boolean> {
    if (!state) return false;

    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        // 일회성: DELETE ... RETURNING으로 조회 + 삭제 원자적 처리
        const result = await pool.query(
            'DELETE FROM oauth_states WHERE state = $1 RETURNING provider, created_at',
            [state]
        );

        if (result.rows.length === 0) {
            // DB에 없으면 폴백에서 시도
            return validateAndConsumeStateFallback(state, expectedProvider);
        }

        const row = result.rows[0];

        // 만료 체크
        if (Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) {
            log.error('[OAuth] State expired');
            return false;
        }

        // Provider 일치 체크
        if (row.provider !== expectedProvider) {
            log.error(`[OAuth] Provider mismatch: expected ${expectedProvider}, got ${row.provider}`);
            return false;
        }

        return true;
    } catch (e) {
        log.warn('[OAuth] DB state 검증 실패, 인메모리 폴백 사용:', e);
        return validateAndConsumeStateFallback(state, expectedProvider);
    }
}

/**
 * 인메모리 폴백 state 검증 (DB 장애 시)
 */
function validateAndConsumeStateFallback(state: string, expectedProvider: string): boolean {
    const data = oauthStatesFallback.get(state);
    if (!data) {
        log.error(`[OAuth] State not found: ${state?.substring(0, 10)}...`);
        return false;
    }

    oauthStatesFallback.delete(state);

    if (Date.now() - data.createdAt > STATE_TTL_MS) {
        log.error('[OAuth] State expired (fallback)');
        return false;
    }

    if (data.provider !== expectedProvider) {
        log.error(`[OAuth] Provider mismatch (fallback): expected ${expectedProvider}, got ${data.provider}`);
        return false;
    }

    return true;
}

/**
 * OAuth redirect URI를 생성합니다.
 *
 * 우선순위:
 * 1. OAUTH_REDIRECT_URI 환경변수 (명시적 설정 시) -- 요청 host 와 무관하게 이 canonical
 *    URI 로 항상 고정 (외부 접속을 openmake.cc 단일 origin 으로 수렴)
 * 2. 요청의 Host/Origin 기반 동적 생성 (개발 환경 localhost 폴백)
 *
 * OAUTH_REDIRECT_URI는 Google용으로 설정되어 있어도 provider 부분을 자동 교체합니다.
 */
export function buildRedirectUri(req: Request, provider: 'google' | 'github' | 'kakao', serverPort: number): string {
    const configuredUri = getConfig().oauthRedirectUri;
    // 외부 접속은 리버스 프록시(Next.js rewrites / Nginx)를 거치므로 req.get('host') 는
    // 프록시 destination(예: localhost:52416)이 되어 redirect_uri 가 외부 주소로 생성되지 않는다.
    // 원본 Host(예: rasplay.tplinkdns.com:33000)는 x-forwarded-host 에 담기므로 이를 우선 사용해
    // Google Console 등록 URI 와 일치시켜 redirect_uri_mismatch 를 방지한다. (trust proxy 신뢰 + Google 승인목록 2차검증)
    const forwardedHost = req.get('x-forwarded-host');
    const requestHost = (forwardedHost ? forwardedHost.split(',')[0].trim() : req.get('host')) || `localhost:${serverPort}`;
    const forwardedProto = req.get('x-forwarded-proto');
    const requestProtocol = (forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol) || 'http';

    const dynamicRedirectUri = `${requestProtocol}://${requestHost}/api/auth/callback/${provider}`;
    log.info(`[OAuth] host 해석: x-forwarded-host=${forwardedHost ?? '(none)'}, raw-host=${req.get('host') ?? '(none)'}, 사용=${requestHost}`);

    // OAUTH_REDIRECT_URI가 명시적으로 설정된 경우(프로덕션), 요청 host 와 무관하게 항상 이
    // canonical URI 로 고정한다. ts.net(Funnel)·rasplay 등 다른 host 로 진입하면 리버스 프록시가
    // 평문이라 proto=http 로 동적 URI 가 만들어져 Google redirect_uri_mismatch 로 실패하던 문제를
    // 차단한다. 어느 진입점이든 로그인 완료는 openmake.cc 단일 origin 으로 착지한다.
    // (redirect_uri 를 요청 host 가 아닌 신뢰된 상수로 고정 → open-redirect 관점에서도 더 안전)
    if (configuredUri && !configuredUri.includes('localhost')) {
        try {
            const configured = new URL(configuredUri);
            const redirectUri = configuredUri.replace(/\/callback\/\w+$/, `/callback/${provider}`);
            if (configured.host !== requestHost) {
                log.info(`[OAuth] host(${requestHost}) → canonical redirect 고정: ${redirectUri}`);
            } else {
                log.info(`[OAuth] Redirect URI (config): ${redirectUri}`);
            }
            return redirectUri;
        } catch {
            log.warn('[OAuth] Invalid OAUTH_REDIRECT_URI format, using dynamic URI');
            log.info(`[OAuth] Redirect URI (dynamic): ${dynamicRedirectUri}`);
            return dynamicRedirectUri;
        }
    }

    // 동적 감지 폴백 (개발 환경 등)
    log.info(`[OAuth] Redirect URI (dynamic): ${dynamicRedirectUri}`);
    return dynamicRedirectUri;
}

/**
 * OAuth 로그인 성공 후 리다이렉트 (Set-Cookie 동반).
 *
 * 302 redirect 대신 200 HTML(meta refresh)로 응답한다 — Next.js dev rewrites(프록시)가
 * 3xx 응답의 Set-Cookie 헤더를 브라우저로 전파하지 못해 외부 접속 시 로그인 세션이
 * 게스트로 떨어지던 문제를 우회한다. 200 응답의 Set-Cookie 는 정상 전파됨.
 * path 는 내부 고정 경로만 전달 (open redirect / XSS 불가).
 */
export function sendOAuthSuccessRedirect(res: Response, path: string): void {
    res.status(200).type('html').send(
        '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">' +
        `<meta http-equiv="refresh" content="0;url=${path}">` +
        '<title>로그인 완료</title></head>' +
        `<body style="font-family:sans-serif">로그인 완료. 이동 중…<br><a href="${path}">계속하기</a></body></html>`,
    );
}
