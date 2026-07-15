/**
 * 사용자별 세션 격리 (hermes group_sessions_per_user 동일):
 * 키 = 채널 ID + 사용자 ID. /reset 슬래시 명령까지 유지, 턴 수 상한으로 트림.
 * v1 은 인메모리 — 프로세스 재시작 시 초기화됨 (영속화는 후속 과제).
 */
import { config } from './config';

export interface ChatTurn {
    role: 'user' | 'assistant';
    content: string;
}

const sessions = new Map<string, ChatTurn[]>();

export function sessionKey(channelId: string, userId: string): string {
    return `${channelId}:${userId}`;
}

export function getHistory(key: string): ChatTurn[] {
    return sessions.get(key) || [];
}

export function appendTurns(key: string, userContent: string, assistantContent: string): void {
    const history = sessions.get(key) || [];
    history.push({ role: 'user', content: userContent }, { role: 'assistant', content: assistantContent });
    const maxMessages = config.sessionMaxTurns * 2;
    if (history.length > maxMessages) {
        history.splice(0, history.length - maxMessages);
    }
    sessions.set(key, history);
}

/** 세션 초기화. 기존 세션이 있었으면 true */
export function resetSession(key: string): boolean {
    return sessions.delete(key);
}
