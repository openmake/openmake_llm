/**
 * Data Module Index
 * 데이터 관련 모듈 통합 export
 */

export * from './user-manager';

// ConversationLogger 전체 구현
class ConversationLoggerImpl {
    private conversations: any[] = [];

    logConversation(message: any) {
        this.conversations.push({
            ...message,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0]
        });
    }

    log(userId: string, message: any) {
        this.logConversation({ ...message, userId });
    }

    getHistory(userId: string, limit: number = 50): any[] {
        return this.conversations.filter(c => c.userId === userId).slice(-limit);
    }

    getRecentConversations(limit: number = 100): any[] {
        return this.conversations.slice(-limit);
    }

    getConversationsByDate(date: string): any[] {
        return this.conversations.filter(c => c.date === date);
    }

    getDailyStats(date?: string): any {
        if (date) {
            const dayConversations = this.getConversationsByDate(date);
            return {
                date,
                total: dayConversations.length,
                users: new Set(dayConversations.map(c => c.userId || 'anonymous')).size
            };
        }
        // 전체 일별 통계
        const grouped = this.conversations.reduce((acc: any, c: any) => {
            const d = c.date || 'unknown';
            if (!acc[d]) acc[d] = { date: d, total: 0, users: new Set() };
            acc[d].total++;
            acc[d].users.add(c.userId || 'anonymous');
            return acc;
        }, {});
        return Object.values(grouped).map((g: any) => ({ ...g, users: g.users.size }));
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
