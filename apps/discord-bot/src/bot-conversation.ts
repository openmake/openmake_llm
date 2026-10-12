/**
 * 봇끼리 대화 규칙. 기본은 꺼짐(허용 목록이 비어 있으면 다른 봇의 메시지를 모두 무시).
 *   - DISCORD_ALLOWED_BOT_IDS 에 든 봇의 메시지만 받는다
 *   - 그 봇이 나를 불렀을 때만 답한다 (멘션·답장 알림, 또는 본문의 멘션 표기)
 *   - 사람 메시지 없이 봇에게 연속으로 답하는 횟수는 채널별 상한에서 멈춘다 (무한 응답 고리 방지)
 */
import { Message } from 'discord.js';
import { config } from './config';

/** 채널별 "사람 메시지 이후 봇에게 답한 횟수". 인메모리 — 재시작하면 0 부터. */
const botTurns = new Map<string, number>();

export function shouldHandleBotMessage(message: Message, botUserId: string): boolean {
    if (message.author.id === botUserId) return false;
    if (!config.allowedBotIds.includes(message.author.id)) return false;
    if (!message.guild) return false;
    if (message.mentions.users.has(botUserId)) return true;
    // 보낸 쪽이 알림을 끈(allowedMentions.parse: []) 멘션은 mentions 에 안 잡혀 본문 표기로 확인한다
    return new RegExp(`<@!?${botUserId}>`).test(message.content);
}

/** 사람이 채널에 글을 썼다 — 그 채널의 연속 횟수를 처음부터 다시 센다. */
export function noteHumanMessage(channelId: string): void {
    botTurns.delete(channelId);
}

/** 봇에게 답할 차례를 하나 쓴다. 상한을 넘었으면 false (답하지 않는다). */
export function tryConsumeBotTurn(channelId: string): boolean {
    const used = botTurns.get(channelId) ?? 0;
    if (used >= config.botExchangeMax) return false;
    botTurns.set(channelId, used + 1);
    return true;
}

/** 테스트용 — 모든 채널의 연속 횟수를 지운다. */
export function resetBotTurns(): void {
    botTurns.clear();
}
