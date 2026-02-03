/**
 * Conversation Model
 * 대화 세션 및 메시지 관리 모델
 * 
 * #17 개선: UnifiedDatabase의 기본 CRUD 위에 비즈니스 로직(트랜잭션, 유효성 검사)을 추가하는 서비스 레이어.
 * UnifiedDatabase가 데이터 접근 계층이라면, 이 모델은 비즈니스 규칙 계층입니다.
 * 
 * 🔒 트랜잭션을 사용하여 데이터 원자성 보장
 */

import { v4 as uuidv4 } from 'uuid';
import { getUnifiedDatabase, ConversationSession, ConversationMessage } from './unified-database';

export class ConversationModel {
    /**
     * 새 세션 생성
     */
    static createSession(userId?: string, title?: string, metadata?: any): ConversationSession {
        const db = getUnifiedDatabase();
        const sessionId = uuidv4();

        db.createSession(sessionId, userId, title || '새 대화', metadata);

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
     * 🔒 트랜잭션으로 메시지 저장과 세션 업데이트를 원자적으로 처리
     */
    static saveMessage(
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
    ): void {
        const db = getUnifiedDatabase();
        const dbInstance = db.getDatabase();

        // 🔒 트랜잭션으로 원자성 보장
        const saveMessageTransaction = dbInstance.transaction(() => {
            // 1. 메시지 저장
            db.addMessage(sessionId, role, content, options);

            // 2. 세션 updated_at 갱신
            dbInstance.prepare(
                'UPDATE conversation_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).run(sessionId);
        });

        saveMessageTransaction();
    }

    /**
     * 세션의 메시지 히스토리 조회
     */
    static getMessages(sessionId: string, limit: number = 100): ConversationMessage[] {
        const db = getUnifiedDatabase();
        return db.getSessionMessages(sessionId, limit);
    }

    /**
     * 사용자의 세션 목록 조회
     */
    static getUserSessions(userId: string, limit: number = 50): ConversationSession[] {
        const db = getUnifiedDatabase();
        return db.getUserSessions(userId, limit);
    }

    /**
     * 전체 세션 목록 조회
     */
    static getAllSessions(limit: number = 50): ConversationSession[] {
        const db = getUnifiedDatabase();
        return db.getAllSessions(limit);
    }

    /**
     * 세션 삭제
     */
    static deleteSession(sessionId: string): boolean {
        const db = getUnifiedDatabase();
        const result = db.deleteSession(sessionId);
        return result.changes > 0;
    }

    /**
     * 세션 제목 업데이트
     */
    static updateSessionTitle(sessionId: string, title: string): boolean {
        const db = getUnifiedDatabase();
        const dbInstance = db.getDatabase();

        const result = dbInstance.prepare(
            'UPDATE conversation_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(title, sessionId);

        return result.changes > 0;
    }

    /**
     * 오래된 세션 정리 (기본: 30일)
     */
    static cleanupOldSessions(daysOld: number = 30): number {
        const db = getUnifiedDatabase();
        const dbInstance = db.getDatabase();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const result = dbInstance.prepare(`
            DELETE FROM conversation_sessions 
            WHERE updated_at < ? AND user_id IS NULL
        `).run(cutoffDate.toISOString());

        return result.changes;
    }
}
