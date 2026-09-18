/**
 * discord add-on 이 Base 레지스트리에 기여하는 선언 (2026-09-19) — 운영 설정 키와 API key 스코프.
 * 순수 데이터다(다른 앱 모듈을 import 하지 않는다 — 설정 레지스트리가 부팅 초기에 읽는다).
 *
 * 봇은 별도 프로세스(PM2 openmake-discord)라 DB overlay 가 자동으로 닿지 않는다 — 기동 시
 * GET /api/integrations/discord/runtime-config 로 받아가므로 전부 requiresRestart.
 * DISCORD_BOT_API_KEY 는 그 요청의 자격증명이라 .env 전용(부트스트랩 순환).
 *
 * @module addons/discord/contributions
 */
import type { AddonContribution } from '../../addon-host/contributions';

/** Discord 봇 프로세스가 기동 시 자기 운영 설정을 받아오는 축 — 추론·브리지는 불가. */
export const DISCORD_API_KEY_SCOPE = 'discord';

export const discordContribution: AddonContribution = {
    apiKeyScopes: [DISCORD_API_KEY_SCOPE],
    settings: [
        { key: 'DISCORD_BOT_TOKEN', group: 'discord', secret: true, requiresRestart: true, validate: 'apiKey', issueUrl: 'https://discord.com/developers/applications' },
        { key: 'DISCORD_BOT_MODEL', group: 'discord', secret: false, requiresRestart: true, validate: 'nonEmpty' },
        { key: 'DISCORD_BOT_REQUEST_TIMEOUT_MS', group: 'discord', secret: false, requiresRestart: true, validate: 'nonNegativeInt' },
        { key: 'DISCORD_ALLOW_ALL_USERS', group: 'discord', secret: false, requiresRestart: true, validate: 'boolean' },
        { key: 'DISCORD_ALLOWED_USERS', group: 'discord', secret: false, requiresRestart: true, validate: 'nonEmpty' },
        { key: 'DISCORD_ALLOWED_ROLES', group: 'discord', secret: false, requiresRestart: true, validate: 'nonEmpty' },
        { key: 'DISCORD_REQUIRE_MENTION', group: 'discord', secret: false, requiresRestart: true, validate: 'boolean' },
        { key: 'DISCORD_FREE_RESPONSE_CHANNELS', group: 'discord', secret: false, requiresRestart: true, validate: 'nonEmpty' },
        { key: 'DISCORD_SESSION_MAX_TURNS', group: 'discord', secret: false, requiresRestart: true, validate: 'nonNegativeInt' },
    ],
};
