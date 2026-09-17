/**
 * Discord 봇이 서버에서 받아가는 설정 키 목록 (L2) — 레지스트리(system-settings-registry)의
 * `discord` 그룹과 짝이다. 여기에 없는 키는 배포되지 않으므로 키를 추가할 땐 양쪽을 함께 고친다.
 *
 * ⚠️ `DISCORD_BOT_API_KEY` 는 이 요청 자체의 자격증명이라 목록에서 제외한다(부트스트랩 순환).
 *
 * @module config/discord-runtime
 */
export const DISCORD_RUNTIME_SETTING_KEYS = [
    'DISCORD_BOT_TOKEN',
    'DISCORD_BOT_MODEL',
    'DISCORD_BOT_REQUEST_TIMEOUT_MS',
    'DISCORD_ALLOW_ALL_USERS',
    'DISCORD_ALLOWED_USERS',
    'DISCORD_ALLOWED_ROLES',
    'DISCORD_REQUIRE_MENTION',
    'DISCORD_FREE_RESPONSE_CHANNELS',
    'DISCORD_SESSION_MAX_TURNS',
] as const;

export type DiscordRuntimeSettingKey = typeof DISCORD_RUNTIME_SETTING_KEYS[number];
