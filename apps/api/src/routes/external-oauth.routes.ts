/**
 * ============================================================
 * External OAuth Routes — ChatGPT 디바이스 플로우 로그인
 * ============================================================
 *
 * ChatGPT Plus/Pro 계정을 OAuth 디바이스 코드 플로우로 연결한다.
 * localhost 콜백이 필요 없어 웹/CLI 어디서든 동작:
 *
 *   1. POST /api/external-keys/:providerId/oauth/start
 *      → OpenAI deviceauth 에서 user_code 발급, 검증 URL 과 함께 반환
 *   2. 사용자가 verification_url(auth.openai.com/codex/device)에서 코드 입력
 *   3. POST /api/external-keys/:providerId/oauth/poll  (프론트가 interval 간격 반복 호출)
 *      → 승인 전: { status: 'pending' }
 *      → 승인 후: authorization_code 교환 → 세션 암호화 저장 → { status: 'complete' }
 *
 * 서버는 폴링 상태를 보관하지 않는다(stateless) — device_auth_id/user_code 는
 * 클라이언트가 들고 다니며, 저장은 승인 완료 시점의 upsert 1회뿐.
 *
 * ⚠️ deviceauth/* 는 비공식 endpoint (Codex CLI 차용) — 사용 전 재검토 필요 시
 *    config/chatgpt-oauth.ts 의 env override 로 무중단 대응.
 *
 * @module routes/external-oauth.routes
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, unauthorized, notFound } from '../utils/api-response';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import {
    CHATGPT_OAUTH,
    chatgptDeviceVerifyUrl,
} from '../config/chatgpt-oauth';
import { getProviderCatalogEntry } from '../config/external-providers';
import {
    serializeSessionPayload,
    extractAccountId,
} from '../providers/chatgpt-oauth/session';
import { createLogger } from '../utils/logger';

const router = Router();
const logger = createLogger('ExternalOAuthRoutes');

let repoInstance: ExternalKeysRepository | null = null;
function getRepo(): ExternalKeysRepository {
    if (!repoInstance) {
        repoInstance = new ExternalKeysRepository(getPool());
    }
    return repoInstance;
}

function getUserId(req: Request): string | null {
    if (req.user && 'userId' in req.user) {
        return (req.user as { userId: string }).userId;
    }
    if (req.user && 'id' in req.user) {
        return String((req.user as { id: unknown }).id);
    }
    return null;
}

/**
 * 제네릭 `:providerId` 경로 가드 — 카탈로그에 존재하고 authMethods 에 'oauth' 를
 * 포함하는 provider 만 통과시킨다. 아니면 res 에 404 를 쓰고 null 반환.
 *
 * 현재 oauth provider 는 chatgpt 하나뿐이라 디바이스 플로우 구현은 CHATGPT_OAUTH
 * 를 그대로 재사용한다 — 경로만 프론트의 제네릭 호출(`/:providerId/oauth/*`)에 맞춰
 * 일반화했다(시한 결합 제거).
 */
function resolveOAuthProviderOr404(req: Request, res: Response): string | null {
    const providerId = req.params.providerId;
    const catalogEntry = getProviderCatalogEntry(providerId);
    if (!catalogEntry || !catalogEntry.authMethods.includes('oauth')) {
        res.status(404).json(
            notFound(`Provider '${providerId}' 는 OAuth 로그인을 지원하지 않습니다`),
        );
        return null;
    }
    return providerId;
}

/**
 * POST /:providerId/oauth/start — 디바이스 코드 발급 (oauth provider 만)
 */
router.post('/:providerId/oauth/start',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('User ID not found.'));
            return;
        }
        if (!resolveOAuthProviderOr404(req, res)) return;

        const response = await fetch(
            `${CHATGPT_OAUTH.ISSUER}/api/accounts/deviceauth/usercode`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client_id: CHATGPT_OAUTH.CLIENT_ID }),
            },
        );
        if (!response.ok) {
            logger.warn(`deviceauth usercode 발급 실패: HTTP ${response.status}`);
            res.status(502).json(
                badRequest(`ChatGPT 디바이스 인증 시작 실패 (HTTP ${response.status})`),
            );
            return;
        }

        const data = (await response.json()) as {
            device_auth_id?: string;
            user_code?: string;
            interval?: string | number;
        };
        if (!data.device_auth_id || !data.user_code) {
            res.status(502).json(badRequest('디바이스 인증 응답 형식 오류'));
            return;
        }

        const intervalSec = Math.max(
            parseInt(String(data.interval), 10) || CHATGPT_OAUTH.DEVICE_POLL_INTERVAL_SEC,
            1,
        );

        logger.info(`ChatGPT 디바이스 인증 시작: user=${userId}`);
        res.json(success({
            device_auth_id: data.device_auth_id,
            user_code: data.user_code,
            verification_url: chatgptDeviceVerifyUrl(),
            interval_sec: intervalSec,
        }));
    }),
);

const pollSchema = z.object({
    device_auth_id: z.string().min(1).max(256),
    user_code: z.string().min(1).max(64),
});

/**
 * POST /:providerId/oauth/poll — 승인 확인 (1회 폴링) + 완료 시 토큰 교환·저장
 */
router.post('/:providerId/oauth/poll',
    requireAuth,
    validate(pollSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('User ID not found.'));
            return;
        }
        const providerId = resolveOAuthProviderOr404(req, res);
        if (!providerId) return;
        const { device_auth_id, user_code } = req.body as z.infer<typeof pollSchema>;

        const pollResponse = await fetch(
            `${CHATGPT_OAUTH.ISSUER}/api/accounts/deviceauth/token`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_auth_id, user_code }),
            },
        );

        // 403/404 = 아직 미승인 (opencode 동일 시맨틱) — pending 으로 응답
        if (pollResponse.status === 403 || pollResponse.status === 404) {
            res.json(success({ status: 'pending' }));
            return;
        }
        if (!pollResponse.ok) {
            logger.warn(`deviceauth token 폴링 실패: HTTP ${pollResponse.status}`);
            res.status(502).json(
                badRequest(`디바이스 인증 확인 실패 (HTTP ${pollResponse.status}) — 처음부터 다시 시도하세요`),
            );
            return;
        }

        const approved = (await pollResponse.json()) as {
            authorization_code?: string;
            code_verifier?: string;
        };
        if (!approved.authorization_code || !approved.code_verifier) {
            res.status(502).json(badRequest('디바이스 승인 응답 형식 오류'));
            return;
        }

        // authorization_code → 토큰 교환 (PKCE verifier 는 deviceauth 가 발급)
        const tokenResponse = await fetch(`${CHATGPT_OAUTH.ISSUER}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: approved.authorization_code,
                redirect_uri: `${CHATGPT_OAUTH.ISSUER}/deviceauth/callback`,
                client_id: CHATGPT_OAUTH.CLIENT_ID,
                code_verifier: approved.code_verifier,
            }).toString(),
        });
        if (!tokenResponse.ok) {
            logger.warn(`OAuth 토큰 교환 실패: HTTP ${tokenResponse.status}`);
            res.status(502).json(
                badRequest(`토큰 교환 실패 (HTTP ${tokenResponse.status}) — 처음부터 다시 시도하세요`),
            );
            return;
        }

        const tokens = (await tokenResponse.json()) as {
            access_token?: string;
            refresh_token?: string;
            id_token?: string;
            expires_in?: number;
        };
        if (!tokens.access_token || !tokens.refresh_token) {
            res.status(502).json(badRequest('토큰 응답 형식 오류'));
            return;
        }

        const accountId = extractAccountId(tokens);
        const expiresAt = new Date(
            Date.now() + (tokens.expires_in ?? CHATGPT_OAUTH.DEFAULT_ACCESS_TOKEN_TTL_SEC) * 1000,
        );
        const catalogEntry = getProviderCatalogEntry(providerId);

        await getRepo().upsert({
            userId,
            providerId,
            sdkType: 'openai-compatible',
            displayName: catalogEntry?.displayName ?? 'ChatGPT',
            baseUrl: catalogEntry?.defaultBaseUrl ?? CHATGPT_OAUTH.CODEX_BASE_URL,
            apiKey: serializeSessionPayload({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                accountId,
                expiresAt: expiresAt.toISOString(),
            }),
            authMethod: 'oauth',
            oauthAccountId: accountId ?? null,
            oauthExpiresAt: expiresAt,
        });
        await getRepo().invalidateCachedModels(userId, providerId);

        logger.info(
            `ChatGPT OAuth 연결 완료: user=${userId} provider=${providerId} account=${accountId ?? 'unknown'}`,
        );
        res.json(success({
            status: 'complete',
            provider_id: providerId,
            account_id: accountId ?? null,
        }));
    }),
);

export default router;
