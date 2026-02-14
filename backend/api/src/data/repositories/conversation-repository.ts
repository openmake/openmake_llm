import type { QueryResult } from 'pg';
import { BaseRepository } from './base-repository';
import type { ConversationMessage, ConversationSession } from '../models/unified-database';

export class ConversationRepository extends BaseRepository {
    async createSession(id: string, userId?: string, title?: string, metadata?: Record<string, unknown> | null): Promise<QueryResult<Record<string, unknown>>> {
        return this.query(
            'INSERT INTO conversation_sessions (id, user_id, title, metadata) VALUES ($1, $2, $3, $4)',
            [id, userId, title || '새 대화', JSON.stringify(metadata || {})]
        );
    }

    async addMessage(sessionId: string, role: string, content: string, options?: {
        model?: string;
        agentId?: string;
        thinking?: string;
        tokens?: number;
        responseTimeMs?: number;
    }): Promise<QueryResult<Record<string, unknown>>> {
        return this.query(
            `INSERT INTO conversation_messages 
            (session_id, role, content, model, agent_id, thinking, tokens, response_time_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                sessionId,
                role,
                content,
                options?.model,
                options?.agentId,
                options?.thinking,
                options?.tokens,
                options?.responseTimeMs
            ]
        );
    }

    async getSessionMessages(sessionId: string, limit: number = 100): Promise<ConversationMessage[]> {
        const result = await this.query<ConversationMessage>(
            'SELECT * FROM conversation_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2',
            [sessionId, limit]
        );
        return result.rows as ConversationMessage[];
    }

    async getUserSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        const result = await this.query<ConversationSession>(
            'SELECT * FROM conversation_sessions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
            [userId, limit]
        );
        return result.rows as ConversationSession[];
    }

    async getAllSessions(limit: number = 50): Promise<ConversationSession[]> {
        const result = await this.query<ConversationSession>(
            'SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT $1',
            [limit]
        );
        return result.rows as ConversationSession[];
    }

    async deleteSession(sessionId: string): Promise<{ changes: number }> {
        const result = await this.query('DELETE FROM conversation_sessions WHERE id = $1', [sessionId]);
        return { changes: result.rowCount || 0 };
    }
}
