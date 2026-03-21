/**
 * ============================================================
 * Conversation DB - 대화 세션 및 메시지 관리 (파사드)
 * ============================================================
 *
 * 대화 세션과 메시지의 전체 생명주기를 관리하는 데이터 접근 레이어입니다.
 * 실제 구현은 하위 모듈로 분리되어 있으며, 이 파일은 기존 import 경로를
 * 유지하기 위한 파사드 + re-export 역할을 합니다.
 *
 * @module data/conversation-db
 *
 * 분할 모듈:
 * - conversation-types.ts    : 인터페이스, Row 타입, 헬퍼 함수
 * - conversation-sessions.ts : 세션 CRUD, 이관, 정리
 * - conversation-messages.ts : 메시지 CRUD, 배치 로딩
 * - conversation-migration.ts: 스키마 초기화, JSON 마이그레이션
 */

import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

// 하위 모듈 import
import { initSchema, migrateFromJson } from './conversation-migration';
import * as sessions from './conversation-sessions';
import * as messages from './conversation-messages';

// 타입 re-export (기존 import 경로 호환)
export type { ConversationSession, ConversationMessage, MessageOptions } from './conversation-types';

const logger = createLogger('ConversationDB');

// 설정: 환경변수로 조정 가능
const SESSION_TTL_DAYS = getConfig().sessionTtlDays;
const MAX_SESSIONS = getConfig().maxConversationSessions;

/**
 * 대화 데이터베이스 접근 클래스
 *
 * PostgreSQL의 conversation_sessions/conversation_messages 테이블에 대한
 * CRUD 작업을 제공합니다. 싱글톤으로 관리됩니다.
 *
 * @class ConversationDB
 */
class ConversationDB {
    /** 스키마 초기화 완료 Promise (race condition 방지) */
    private initReady: Promise<void>;

    constructor() {
        this.initReady = this.init().catch(err => { logger.error('[ConversationDB] Init failed:', err); });
    }

    /** 스키마 초기화 완료를 보장하는 헬퍼 */
    async ensureReady(): Promise<void> {
        await this.initReady;
    }

    private async init(): Promise<void> {
        await initSchema();
        await migrateFromJson();
    }

    // ===== Session Operations (위임) =====

    createSession = sessions.createSession;
    getSession = sessions.getSession;
    getSessionsByUserId = sessions.getSessionsByUserId;
    getSessionsByAnonId = sessions.getSessionsByAnonId;
    getAllSessions = sessions.getAllSessions;
    getSessions = sessions.getSessions;
    getUserSessions = sessions.getUserSessions;
    updateSessionTitle = sessions.updateSessionTitle;
    deleteSession = sessions.deleteSession;
    deleteAllSessionsByUserId = sessions.deleteAllSessionsByUserId;
    claimAnonymousSessions = sessions.claimAnonymousSessions;
    cleanupOldSessions = sessions.cleanupOldSessions;

    // ===== Message Operations (위임) =====

    getMessages = messages.getMessages;
    addMessage = messages.addMessage;

    // saveMessage 별칭 메서드 (server.ts 호환성)
    saveMessage = messages.addMessage;
}

/** 싱글톤 인스턴스 (lazy initialization) */
let dbInstance: ConversationDB | null = null;

/**
 * ConversationDB 싱글톤 인스턴스를 반환합니다.
 *
 * @returns ConversationDB 인스턴스
 */
export function getConversationDB() {
    if (!dbInstance) {
        dbInstance = new ConversationDB();
        logger.info(`[ConversationDB] Config: max sessions ${MAX_SESSIONS}, TTL ${SESSION_TTL_DAYS} days`);
    }
    return dbInstance;
}

/** 세션 정리 스케줄러 타이머 (BUG-021 수정: setInterval 반환값이므로 ReturnType<typeof setInterval> 사용) */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 만료 세션 자동 정리 스케줄러를 시작합니다.
 * 지정된 간격으로 30일 이상 된 세션을 삭제합니다.
 *
 * @param intervalHours - 정리 실행 간격 (시간 단위, 기본값: 24)
 */
export function startSessionCleanupScheduler(intervalHours: number = 24) {
    if (cleanupTimer) clearInterval(cleanupTimer);

    logger.info(`[ConversationDB] Cleanup scheduler started (interval: ${intervalHours}h)`);

    cleanupTimer = setInterval(async () => {
        try {
            const count = await getConversationDB().cleanupOldSessions(30);
            if (count > 0) {
                logger.info(`[ConversationDB] Cleaned ${count} old sessions`);
            }
        } catch (error) {
            logger.error('[ConversationDB] Cleanup error:', error);
        }
    }, intervalHours * 60 * 60 * 1000);
}

/**
 * 세션 정리 스케줄러를 중지합니다.
 * 서버 graceful shutdown 시 호출합니다.
 */
export function stopSessionCleanupScheduler(): void {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
        logger.info('[ConversationDB] Cleanup scheduler stopped');
    }
}
