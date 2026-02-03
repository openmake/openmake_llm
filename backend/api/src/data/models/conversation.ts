/**
 * Conversation Model
 * 대화 세션 및 메시지 관리 모델
 */

import { v4 as uuidv4 } from 'uuid';
import { getUnifiedDatabase, getPool, ConversationSession, ConversationMessage } from './unified-database';

export class ConversationModel {
    /**
     * 새 세션 생성
     */
    static async createSession(userId?: string, title?: string, metadata?: any): Promise<ConversationSession> {
        const db = getUnifiedDatabase();
        const sessionId = uuidv4();

        await db.createSession(sessionId, userId, title || '새 대화', metadata);

        return {
            id: sessionId,
            user_id: userId,
            title: title || '새 대화',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata
        };
    }

    /**
     * 메시지 저장
     */
    static async saveMessage(
        sessionId: string,
        role: 'user' | 'assistant' | 'system',
        content: string,
        options?: {
            model?: string;
            agentId?: string;
            thinking?: string;
            tokens?: number;
            responseTimeMs?: number;
        }
    ): Promise<void> {
        const db = getUnifiedDatabase();
        await db.addMessage(sessionId, role, content, options);

        // 세션 updated_at 갱신
        const pool = getPool();
        await pool.query(
            'UPDATE conversation_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [sessionId]
        );
    }

    /**
     * 세션의 메시지 히스토리 조회
     */
    static async getMessages(sessionId: string, limit: number = 100): Promise<ConversationMessage[]> {
        const db = getUnifiedDatabase();
        return await db.getSessionMessages(sessionId, limit);
    }

    /**
     * 사용자의 세션 목록 조회
     */
    static async getUserSessions(userId: string, limit: number = 50): Promise<ConversationSession[]> {
        const db = getUnifiedDatabase();
        return await db.getUserSessions(userId, limit);
    }

    /**
     * 전체 세션 목록 조회
     */
    static async getAllSessions(limit: number = 50): Promise<ConversationSession[]> {
        const db = getUnifiedDatabase();
        return await db.getAllSessions(limit);
    }

    /**
     * 세션 삭제
     */
    static async deleteSession(sessionId: string): Promise<boolean> {
        const db = getUnifiedDatabase();
        const result = await db.deleteSession(sessionId);
        return result.changes > 0;
    }

    /**
     * 세션 제목 업데이트
     */
    static async updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
        const pool = getPool();

        const result = await pool.query(
            'UPDATE conversation_sessions SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [title, sessionId]
        );

        return (result.rowCount || 0) > 0;
    }

    /**
     * 오래된 세션 정리 (기본: 30일)
     */
    static async cleanupOldSessions(daysOld: number = 30): Promise<number> {
        const pool = getPool();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const result = await pool.query(`
            DELETE FROM conversation_sessions 
            WHERE updated_at < $1 AND user_id IS NULL
        `, [cutoffDate.toISOString()]);

        return result.rowCount || 0;
    }
}
