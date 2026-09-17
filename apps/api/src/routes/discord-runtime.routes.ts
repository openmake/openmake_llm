/**
 * Discord 봇 런타임 설정 배포 (2026-09-18) — 봇은 PM2 별도 프로세스라 DB overlay 가 닿지 않는다.
 * 기동 시 이 라우트로 유효 설정(DB system_settings > .env)을 받아가고, 실패하면 자기 .env 로 폴백한다.
 *
 * 인증은 API key + `discord` 스코프 전용(JWT 경로 없음) — 응답에 봇 토큰 평문이 실리므로
 * 추론(`chat`)·브리지(`bridge`) 키로는 호출할 수 없다. 조회 사실은 감사 로그로 남긴다.
 *
 * @module routes/discord-runtime
 */
import { Router, Request, Response } from 'express';
import { requireApiKey, requireScope } from '../middlewares/api-key-auth';
import { API_KEY_SCOPES } from '../config/api-key-scopes';
import { DISCORD_RUNTIME_SETTING_KEYS } from '../config/discord-runtime';
import { getSystemSettingsService } from '../services/system-settings-service';
import { getAuditService } from '../services/AuditService';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { createLogger } from '../utils/logger';

const logger = createLogger('DiscordRuntimeRoutes');
export const discordRuntimeRouter = Router();

/** GET /api/integrations/discord/runtime-config — 봇 기동 시 1회 조회 */
discordRuntimeRouter.get(
    '/runtime-config',
    requireApiKey,
    requireScope(API_KEY_SCOPES.DISCORD),
    asyncHandler(async (req: Request, res: Response) => {
        const settings = getSystemSettingsService().getEffectiveValues(DISCORD_RUNTIME_SETTING_KEYS);
        // 값은 남기지 않는다(토큰 평문) — 누가 어떤 키를 받아갔는지만.
        await getAuditService().logAudit({
            userId: String(req.user?.id ?? ''),
            action: 'discord_runtime_config_fetch',
            resourceType: 'system_settings',
            details: { keys: Object.keys(settings) },
            ipAddress: req.ip,
        }).catch(() => { /* 감사 실패가 봇 기동을 막지 않는다 */ });
        logger.info(`[DiscordRuntime] 설정 배포 ${Object.keys(settings).length}건 (user ${req.user?.id})`);
        res.json(success({ settings }));
    }),
);
