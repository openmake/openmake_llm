/**
 * hermes-agent 동일 의미론의 접근 제어:
 *   allow-all 명시 → 전원 허용
 *   그 외 → 허용 사용자 목록 또는 허용 역할 보유자만 (기본 전원 거부)
 */
import { Message } from 'discord.js';
import { config } from './config';

export function isUserAllowed(message: Message): boolean {
    if (config.allowAllUsers) return true;
    if (config.allowedUsers.includes(message.author.id)) return true;
    if (config.allowedRoles.length > 0 && message.member) {
        return message.member.roles.cache.some((role) => config.allowedRoles.includes(role.id));
    }
    return false;
}

/**
 * 이 메시지에 응답해야 하는가 (멘션/채널 규칙).
 * DM → 항상 응답. 서버 채널 → 자유응답 채널이거나, 멘션 필수 설정 시 봇 멘션 포함일 때만.
 */
export function shouldRespond(message: Message, botUserId: string): boolean {
    if (!message.guild) return true; // DM
    if (config.freeResponseChannels.includes(message.channelId)) return true;
    if (!config.requireMention) return true;
    return message.mentions.users.has(botUserId);
}

/** 봇 멘션 토큰(<@id>, <@!id>)을 본문에서 제거 */
export function stripBotMention(content: string, botUserId: string): string {
    return content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').trim();
}
