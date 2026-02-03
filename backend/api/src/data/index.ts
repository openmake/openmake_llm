/**
 * Data Module Index
 * 데이터 관련 모듈 통합 export
 */

export * from './user-manager';

/** Conversation log entry */
interface ConversationLogEntry {
    userId?: string;
    timestamp: string;
    date: string;
    [key: string]: unknown;
}

/** Daily stats entry */
interface DailyStatsEntry {
    date: string;
    total: number;
    users: number | Set<string>;
}

// ConversationLogger 전체 구현
class ConversationLoggerImpl {
    private conversations: ConversationLogEntry[] = [];

    logConversation(message: Record<string, unknown>) {
        this.conversations.push({
            ...message,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0]
        });
    }

    log(userId: string, message: Record<string, unknown>) {
        this.logConversation({ ...message, userId });
    }

    getHistory(userId: string, limit: number = 50): ConversationLogEntry[] {
        return this.conversations.filter(c => c.userId === userId).slice(-limit);
    }

    getRecentConversations(limit: number = 100): ConversationLogEntry[] {
        return this.conversations.slice(-limit);
    }

    getConversationsByDate(date: string): ConversationLogEntry[] {
        return this.conversations.filter(c => c.date === date);
    }

    getDailyStats(date?: string): DailyStatsEntry | DailyStatsEntry[] {
        if (date) {
            const dayConversations = this.getConversationsByDate(date);
            return {
                date,
                total: dayConversations.length,
                users: new Set(dayConversations.map(c => c.userId || 'anonymous')).size
            };
        }
        // 전체 일별 통계
        const grouped = this.conversations.reduce((acc: Record<string, { date: string; total: number; users: Set<string> }>, c) => {
            const d = c.date || 'unknown';
            if (!acc[d]) acc[d] = { date: d, total: 0, users: new Set() };
            acc[d].total++;
            acc[d].users.add(c.userId || 'anonymous');
            return acc;
        }, {});
        return Object.values(grouped).map((g) => ({ ...g, users: g.users.size }));
    }

    clear(userId?: string) {
        if (userId) {
            this.conversations = this.conversations.filter(c => c.userId !== userId);
        } else {
            this.conversations = [];
        }
    }
}

let loggerInstance: ConversationLoggerImpl | null = null;

export function getConversationLogger(): ConversationLoggerImpl {
    if (!loggerInstance) loggerInstance = new ConversationLoggerImpl();
    return loggerInstance;
}
