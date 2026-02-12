/**
 * ============================================================
 * Session Controller
 * ============================================================
 * 대화 세션 관리 API 라우트
 */

import { Request, Response, Router } from 'express';
import { getConversationDB, ConversationSession } from '../data/conversation-db';
import { optionalAuth, requireAuth } from '../auth';
import { createLogger } from '../utils/logger';
import { success, internalError } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getConfig } from '../config';

const log = createLogger('SessionController');

/**
 * 대화 세션 관리 컨트롤러
 * 
 * @class SessionController
 * @description
 * - 세션 목록 조회 (사용자 격리)
 * - 세션 생성
 * - 세션 메시지 조회
 * - 메시지 저장
 * - 세션 제목 업데이트
 * - 세션 삭제
 */
export class SessionController {
    /** Express 라우터 인스턴스 */
    private router: Router;

    /**
     * SessionController 인스턴스를 생성합니다.
     */
    constructor() {
        this.router = Router();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        const conversationDb = getConversationDB();
        const envConfig = getConfig();

         // 세션 목록 조회 (사용자 격리 적용)
         this.router.get('/', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
             const user = req.user;
             const anonSessionId = req.query.anonSessionId as string;
             const viewAll = req.query.viewAll === 'true';
             const viewMineOnly = req.query.viewMineOnly === 'true';
             const limit = parseInt(req.query.limit as string) || 50;

             // 🔍 디버그 로그 - 문제 해결 후 제거
             log.info(`[Chat Sessions] 🔍 DEBUG - user: ${JSON.stringify(user)}, anonSessionId: ${anonSessionId}, viewAll: ${viewAll}, viewMineOnly: ${viewMineOnly}`);

             let sessions: ConversationSession[];
             const isAdminUser = user?.role === 'admin';

             log.info(`[Chat Sessions] 🔍 DEBUG - isAdminUser: ${isAdminUser}, role: ${user?.role}`);

             // 🔑 관리자: 기본적으로 전체 조회 (viewMineOnly=true면 자신만)
             if (isAdminUser && !viewMineOnly) {
                 sessions = await conversationDb.getAllSessions(limit);
                 log.info(`[Chat Sessions] 관리자 전체 조회: ${sessions.length}개`);
             } else if (user?.id) {
                 // 🔐 로그인 사용자: 자신의 대화만 (userId를 문자열로 변환하여 비교)
                 const userIdStr = String(user.id);
                 sessions = await conversationDb.getSessionsByUserId(userIdStr, limit);
                 log.info(`[Chat Sessions] 사용자 ${userIdStr} 조회: ${sessions.length}개`);
             } else if (anonSessionId) {
                 // 🔒 비로그인 사용자: 해당 익명 세션만
                 sessions = await conversationDb.getSessionsByAnonId(anonSessionId, limit);
                 log.info(`[Chat Sessions] 익명 세션 ${anonSessionId} 조회: ${sessions.length}개`);
             } else {
                 // 인증 정보 없음: 빈 배열 반환
                 sessions = [];
                 log.info(`[Chat Sessions] 인증 정보 없음 - 빈 배열 반환`);
             }

             // 프론트엔드 호환을 위해 snake_case → camelCase 변환
             const formattedSessions = sessions.map((s) => ({
                 id: s.id,
                 userId: s.userId,
                 anonSessionId: s.anonSessionId,
                 title: s.title,
                 createdAt: s.created_at,
                 updatedAt: s.updated_at,
                 metadata: s.metadata,
                 messageCount: s.messages?.length || 0,
                 // 🆕 첫 번째 메시지에서 모델 정보 추출 (없으면 기본 모델 표시)
                 model: (s.messages?.[0] as unknown as Record<string, unknown>)?.model || (s as unknown as Record<string, unknown>).model || envConfig.ollamaDefaultModel || 'Ollama'
             }));

             res.json(success({ sessions: formattedSessions }));
         }));

         // 🆕 익명 세션 이관: 로그인 후 기존 익명 대화를 사용자에게 귀속
         // ⚠️ /:sessionId 라우트보다 앞에 위치해야 '/claim'이 파라미터로 잡히지 않음
         this.router.post('/claim', requireAuth, asyncHandler(async (req: Request, res: Response) => {
             const user = req.user;
             const { anonSessionId } = req.body;

             if (!user?.id) {
                 res.status(401).json({ success: false, error: { message: '인증이 필요합니다' } });
                 return;
             }

             if (!anonSessionId || typeof anonSessionId !== 'string') {
                 res.status(400).json({ success: false, error: { message: 'anonSessionId가 필요합니다' } });
                 return;
             }

             const userId = String(user.id);
             const claimed = await conversationDb.claimAnonymousSessions(userId, anonSessionId);
             log.info(`[Chat Sessions] 익명 세션 이관: userId=${userId}, anonSessionId=${anonSessionId}, claimed=${claimed}`);

             res.json(success({ claimed }));
         }));

         // 새 세션 생성 (anonSessionId 지원)
         this.router.post('/', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
             const user = req.user;
             const { title, model, anonSessionId } = req.body;

             // 로그인 사용자는 userId 사용, 비로그인은 anonSessionId 사용
             const userId = user?.id ? String(user.id) : undefined;
             const anonId = userId ? undefined : anonSessionId;

             const session = await conversationDb.createSession(userId, title, model, anonId);

             // 응답에 camelCase 포맷 적용
             res.json(success({
                 session: {
                     id: session.id,
                     userId: session.userId,
                     anonSessionId: session.anonSessionId,
                     title: session.title,
                     createdAt: session.created_at,
                     updatedAt: session.updated_at
                 }
             }));
         }));

         // 세션 메시지 조회
         this.router.get('/:sessionId/messages', asyncHandler(async (req: Request, res: Response) => {
             const { sessionId } = req.params;
             const limit = parseInt(req.query.limit as string) || 100;
             const messages = await conversationDb.getMessages(sessionId, limit);
             res.json(success({ messages }));
         }));

         // 메시지 저장
         this.router.post('/:sessionId/messages', asyncHandler(async (req: Request, res: Response) => {
             const { sessionId } = req.params;
             const { role, content, model, tokensUsed, responseTime } = req.body;
             const message = await conversationDb.saveMessage(sessionId, role, content, {
                 model, tokensUsed, responseTime
             });
             res.json(success({ message }));
         }));

         // 세션 제목 업데이트
         this.router.patch('/:sessionId', asyncHandler(async (req: Request, res: Response) => {
             const { sessionId } = req.params;
             const { title } = req.body;
             const updated = await conversationDb.updateSessionTitle(sessionId, title);
             res.json(success({ updated }));
         }));

         // 세션 삭제
         this.router.delete('/:sessionId', asyncHandler(async (req: Request, res: Response) => {
             const { sessionId } = req.params;
             const deleted = await conversationDb.deleteSession(sessionId);
             res.json(success({ deleted }));
         }));

        log.info('[SessionController] 세션 관리 API 라우트 설정 완료');
    }

    /**
     * Express 라우터를 반환합니다.
     * @returns 설정된 Router 인스턴스
     */
    getRouter(): Router {
        return this.router;
    }
}

/**
 * SessionController 인스턴스를 생성하는 팩토리 함수
 * 
 * @returns 설정된 Express Router
 */
export function createSessionController(): Router {
    return new SessionController().getRouter();
}
