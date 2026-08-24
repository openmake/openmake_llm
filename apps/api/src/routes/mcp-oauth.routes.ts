/**
 * 원격 MCP 서버 OAuth 라우트 — mount: `/api/mcp`
 *
 *   POST   /servers/:id/oauth/start   → { authorizationUrl }  (프론트가 브라우저를 이동)
 *   GET    /oauth/callback?code&state → 토큰 교환 → 서버 재연결 → 커넥터 탭으로 리디렉트
 *   DELETE /servers/:id/oauth         → 토큰·등록 삭제(로그아웃) + 연결 정리
 *
 * SDK `auth()` 를 그대로 쓴다 — 리소스 메타데이터 발견(RFC 9728) → AS 메타데이터(RFC 8414) →
 * 동적 등록(RFC 7591) → PKCE 인가 URL 생성까지 SDK 가 하고, 이 라우트는 provider 가 붙잡은
 * URL 을 돌려주거나(start) code 를 넘겨 토큰을 받는다(callback).
 *
 * 🔒 콜백은 `requireAuth` 다 — 인가 서버가 브라우저를 돌려보내므로 우리 쿠키가 따라온다.
 *    state 는 KV 1회용이고 그 안의 userId 가 요청 사용자와 같아야 한다(타인 세션에 토큰 심기 차단).
 *    외부로 나가는 fetch 는 전부 `createPinnedFetch`(SSRF 가드) 를 쓴다.
 *
 * @module routes/mcp-oauth.routes
 */
import { Router, type Request, type Response } from 'express';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { requireAuth } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, notFound, forbidden, internalError } from '../utils/api-response';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import { McpOAuthRepository } from '../data/repositories/mcp-oauth-repository';
import { McpOAuthProvider, consumeMcpOAuthState } from '../mcp/oauth-provider';
import { getLifecycleSupervisor } from '../mcp/lifecycle-supervisor';
import { createPinnedFetch } from '../security/ssrf-guard';
import { canStartStopServer } from './mcp-visibility';
import { MCP_OAUTH_RETURN_PATH } from '../config/mcp-oauth';
import { classifyConnectError } from '../mcp/connect-error';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpOAuthRoutes');
export const mcpOAuthRouter = Router();

/** 리디렉트 목적지 — 결과와 서버명을 쿼리로 싣는다 (상대경로라 open-redirect 없음) */
function returnTo(result: 'ok' | 'error', extra: Record<string, string> = {}): string {
    const q = new URLSearchParams({ mcpOauth: result, ...extra });
    return `${MCP_OAUTH_RETURN_PATH}&${q.toString()}`;
}

/** 원격 transport 인 사용자 소유 서버만 OAuth 대상이다 */
async function loadOAuthTarget(req: Request, res: Response) {
    const userId = String(req.user?.id ?? '');
    const actor = { id: userId, role: req.user?.role ?? 'user' };
    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const server = await repo.getServerById(req.params.id);
    if (!server) { res.status(404).json(notFound('서버')); return null; }
    if (!canStartStopServer(actor, server)) { res.status(403).json(forbidden('해당 서버를 변경할 권한이 없습니다')); return null; }
    if (server.transport_type === 'stdio' || !server.url) {
        res.status(400).json(badRequest('원격(sse/streamable-http) 서버만 OAuth 로그인을 지원합니다'));
        return null;
    }
    return { server, userId, ownerId: String(server.user_id ?? userId) };
}

/** 인가 URL 발급 — provider 가 redirectToAuthorization 으로 붙잡은 URL 을 돌려준다 */
mcpOAuthRouter.post('/servers/:id/oauth/start', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const target = await loadOAuthTarget(req, res);
    if (!target) return;
    const provider = new McpOAuthProvider({ serverId: target.server.id, userId: target.ownerId });
    // 기존 토큰이 있으면 SDK 가 갱신을 시도해 AUTHORIZED 를 돌려줄 수 있다 — 그 경우 로그인 불필요.
    // 재로그인을 강제하려면 먼저 DELETE 로 지운다.
    const result = await auth(provider, { serverUrl: target.server.url as string, fetchFn: createPinnedFetch() });
    if (result === 'AUTHORIZED') {
        res.json(success({ authorized: true, authorizationUrl: null }));
        return;
    }
    if (!provider.capturedAuthorizationUrl) {
        res.status(500).json(internalError('인가 URL 을 만들지 못했습니다'));
        return;
    }
    logger.info(`OAuth start s=${target.server.id} u=${target.ownerId} → ${provider.capturedAuthorizationUrl.origin}`);
    res.json(success({ authorized: false, authorizationUrl: provider.capturedAuthorizationUrl.toString() }));
}));

/** 인가 콜백 — code 를 토큰으로 바꾸고 서버를 다시 띄운 뒤 커넥터 탭으로 돌려보낸다 */
mcpOAuthRouter.get('/oauth/callback', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const providerError = typeof req.query.error === 'string' ? req.query.error : '';
    if (providerError) { res.redirect(returnTo('error', { reason: providerError.slice(0, 64) })); return; }
    if (!code || !state) { res.redirect(returnTo('error', { reason: 'missing_code_or_state' })); return; }

    const record = await consumeMcpOAuthState(state);
    if (!record) { res.redirect(returnTo('error', { reason: 'state_expired' })); return; }
    // 🔒 state 를 만든 사용자만 콜백을 완료할 수 있다
    if (record.userId !== String(req.user?.id ?? '')) { res.redirect(returnTo('error', { reason: 'state_user_mismatch' })); return; }

    const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
    const server = await repo.getServerById(record.serverId);
    if (!server?.url) { res.redirect(returnTo('error', { reason: 'server_not_found' })); return; }

    try {
        const provider = new McpOAuthProvider({ serverId: server.id, userId: record.userId });
        const result = await auth(provider, { serverUrl: server.url, authorizationCode: code, fetchFn: createPinnedFetch() });
        if (result !== 'AUTHORIZED') throw new Error(`unexpected auth result: ${result}`);
        await provider.invalidateCredentials('verifier');
        logger.info(`OAuth 완료 s=${server.id} u=${record.userId}`);

        // 토큰이 생겼으니 곧바로 연결해 본다 — 실패해도 로그인 자체는 성공이라 리디렉트는 ok
        const supervisor = getLifecycleSupervisor();
        if (supervisor) {
            await supervisor.killUserServer(record.userId, server.id).catch(() => { /* 없으면 무시 */ });
            await supervisor.spawnUserServer(record.userId, server.id).catch((e: unknown) =>
                logger.warn(`OAuth 후 재연결 실패 s=${server.id}: ${classifyConnectError(e).message}`));
        }
        res.redirect(returnTo('ok', { server: server.name }));
    } catch (e) {
        const c = classifyConnectError(e);
        logger.warn(`OAuth 토큰 교환 실패 s=${server.id} u=${record.userId} [${c.code}] ${c.message}`);
        res.redirect(returnTo('error', { reason: 'token_exchange_failed', server: server.name }));
    }
}));

/** 로그아웃 — 토큰·동적 등록을 지우고 살아있는 연결을 정리한다 */
mcpOAuthRouter.delete('/servers/:id/oauth', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const target = await loadOAuthTarget(req, res);
    if (!target) return;
    await new McpOAuthRepository(getUnifiedDatabase().getPool()).clearAll(target.server.id, target.ownerId);
    const supervisor = getLifecycleSupervisor();
    if (supervisor) await supervisor.killUserServer(target.ownerId, target.server.id).catch(() => { /* 없으면 무시 */ });
    res.json(success({ id: target.server.id, loggedOut: true }));
}));
