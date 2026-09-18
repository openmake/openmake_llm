/**
 * Discord 봇 런타임 설정 키 — 봇이 기동 시 받아가는 값. 기여 선언(contributions.ts)의 설정 키와 같은 목록이다.
 *
 * @module addons/discord/runtime-keys
 */
import { discordContribution } from './contributions';

export const DISCORD_RUNTIME_SETTING_KEYS: readonly string[] = (discordContribution.settings ?? []).map(s => s.key);
