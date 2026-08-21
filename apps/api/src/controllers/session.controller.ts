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
import { success, unauthorized, badRequest, forbidden } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { historySummaryCache } from '../services/chat-service/history-summary-cache';
import { isAdminRole } from '../data/user-manager';

const log = createLogger('SessionController');

/**
 * 세션 접근 권한 판정 (순수 함수 — 단위 테스트 가능).
 *
 * ⚠️ 양쪽 비교값이 truthy 일 때만 매칭한다. session 의 userId/anonSessionId 는 서로
 * 배타적이라 항상 한쪽이 undefined 이고, 요청측도 미인증·무파라미터면 둘 다 undefined 라
 * `undefined === undefined` 로 통과하는 IDOR 가 발생한다 (artifact-session-access.ts 와 동일 가드).
 */
export function evaluateSessionAccess(
    session: Pick<ConversationSession, 'userId' | 'anonSessionId'> | undefined,
    ctx: { userId?: string; anonSessionId?: string; isAdmin: boolean },
): boolean {
    if (ctx.isAdmin) {
        return true;
    }
    if (!session) {
        return false;
    }
    if (ctx.userId && session.userId === ctx.userId) {
        return true;
    }
    if (ctx.anonSessionId && session.anonSessionId === ctx.anonSessionId) {
        return true;
    }
    return false;
}

/** 세션 목록 조회 범위 (순수 함수 — 단위 테스트 가능) */
export type SessionListScope = 'all' | 'user' | 'anon' | 'none';

/**
 * 세션 목록 조회 범위 판정.
 *
 * 관리자 전체 조회는 명시적 옵트인(`viewAll=true`, 관리자 전용 화면 /admin/conversations 사용)
 * 으로만 허용한다 — 과거엔 관리자 기본이 전체 조회라 개인 히스토리·사이드바에
 * 모든 사용자의 대화가 섞여 노출됐다. 비관리자의 viewAll 은 무시된다.
 */
export function resolveSessionListScope(
    ctx: { isAdmin: boolean; viewAll: boolean; userId?: string; anonSessionId?: string },
): SessionListScope {
    if (ctx.isAdmin && ctx.viewAll) {
        return 'all';
    }
    if (ctx.userId) {
        return 'user';
    }
    if (ctx.anonSessionId) {
        return 'anon';
    }
    return 'none';
}

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
        const hasSessionAccess = (session: ConversationSession | undefined, req: Request): boolean =>
            evaluateSessionAccess(session, {
                userId: req.user?.id ? String(req.user.id) : undefined,
                anonSessionId: typeof req.query.anonSessionId === 'string' ? req.query.anonSessionId : undefined,
                isAdmin: isAdminRole(req.user?.role),
            });

         // 세션 목록 조회 (사용자 격리 적용). ?q= 지정 시 제목+메시지 본문 검색
         // (user/anon 스코프 전용 — admin viewAll 전체 목록에는 미적용).
         this.router.get('/', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
             const user = req.user;
             const anonSessionId = req.query.anonSessionId as string;
             const limit = parseInt(req.query.limit as string) || 50;
             // offset 은 관리자 전체 조회(scope 'all') 페이지네이션 전용 — 음수/비정상 입력은 0
             const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
             const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

             const userIdStr = user?.id ? String(user.id) : undefined;
             const scope = resolveSessionListScope({
                 isAdmin: isAdminRole(user?.role),
                 viewAll: req.query.viewAll === 'true',
                 userId: userIdStr,
                 anonSessionId: typeof anonSessionId === 'string' ? anonSessionId : undefined,
             });

             let sessions: ConversationSession[];
             let snippets: Record<string, string> = {};
             // 관리자 전체 조회의 총 건수 — 페이지네이션 UI 용 (다른 scope 는 undefined 유지, 하위 호환)
             let total: number | undefined;
             if (q && (scope === 'user' || scope === 'anon')) {
                 const hit = await conversationDb.searchSessionsByOwner(
                     scope === 'user' ? { userId: userIdStr } : { anonSessionId },
                     q, limit,
                 );
                 sessions = hit.sessions;
                 snippets = hit.snippets;
                 log.info(`[Chat Sessions] 검색(${scope}) "${q.slice(0, 40)}": ${sessions.length}개`);
             } else if (scope === 'all') {
                 // 🔑 관리자 전용 화면(/admin/conversations)의 명시적 전체 조회 — offset 페이지네이션
                 [sessions, total] = await Promise.all([
                     conversationDb.getAllSessions(limit, offset),
                     conversationDb.countAllSessions(),
                 ]);
                 log.info(`[Chat Sessions] 관리자 전체 조회: ${sessions.length}개 (offset=${offset}, total=${total})`);
             } else if (scope === 'user') {
                 // 🔐 로그인 사용자: 자신의 대화만 (관리자도 개인 화면에선 동일)
                 sessions = await conversationDb.getSessionsByUserId(userIdStr!, limit);
                 log.info(`[Chat Sessions] 사용자 ${userIdStr} 조회: ${sessions.length}개`);
             } else if (scope === 'anon') {
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
                 // 🆕 첫 번째 메시지에서 모델 정보 추출 (모델명으로 표시)
                 model: s.messages?.[0]?.model || 'OpenMake LLM Auto',
                 // 본문 검색(?q=) 매칭 시 발췌 — 비검색 응답에는 항상 undefined (하위 호환)
                 ...(snippets[s.id] ? { snippet: snippets[s.id] } : {}),
             }));

             // total 은 관리자 전체 조회(scope 'all')에만 실림 — 기존 소비처(사이드바/히스토리) 무영향
             res.json(success({ sessions: formattedSessions, ...(total !== undefined ? { total } : {}) }));
         }));

         // 🆕 익명 세션 이관: 로그인 후 기존 익명 대화를 사용자에게 귀속
         // ⚠️ /:sessionId 라우트보다 앞에 위치해야 '/claim'이 파라미터로 잡히지 않음
         this.router.post('/claim', requireAuth, asyncHandler(async (req: Request, res: Response) => {
             const user = req.user;
             const { anonSessionId } = req.body;

             if (!user?.id) {
                 res.status(401).json(unauthorized('인증이 필요합니다'));
                 return;
             }

             if (!anonSessionId || typeof anonSessionId !== 'string') {
                 res.status(400).json(badRequest('anonSessionId가 필요합니다'));
                 return;
             }

             // 🔒 Phase 3 보안 패치: anonSessionId 형식 검증
             // UUID v4 형식만 허용하여 무작위 대입 공격 방지
             const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
             if (!uuidRegex.test(anonSessionId)) {
                 res.status(400).json(badRequest('유효하지 않은 세션 ID 형식입니다'));
                 return;
             }

             // 🔒 Phase 3 보안 패치: 클레이밍 속도 제한
             // 동일 사용자가 짧은 시간에 여러 세션을 클레이밍하는 것을 방지
             const userId = String(user.id);
             const claimed = await conversationDb.claimAnonymousSessions(userId, anonSessionId);
             log.info(`[Chat Sessions] 익명 세션 이관: userId=${userId}, anonSessionId=${anonSessionId}, claimed=${claimed}`);

             res.json(success({ claimed }));
         }));

         // 🆕 전체 세션 삭제: 로그인 사용자의 모든 대화 기록 삭제
         this.router.delete('/', requireAuth, asyncHandler(async (req: Request, res: Response) => {
             const user = req.user;
             if (!user?.id) {
                 res.status(401).json(unauthorized('인증이 필요합니다'));
                 return;
             }
             const userId = String(user.id);
             const deletedCount = await conversationDb.deleteAllSessionsByUserId(userId);
             log.info(`[Chat Sessions] 전체 삭제: userId=${userId}, deleted=${deletedCount}`);
             res.json(success({ deleted: true, count: deletedCount }));
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
         this.router.get('/:sessionId/messages', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
              const { sessionId } = req.params;
              const session = await conversationDb.getSession(sessionId);
              if (!hasSessionAccess(session, req)) {
                  res.status(403).json(forbidden('권한이 없습니다'));
                  return;
              }

              const limit = parseInt(req.query.limit as string) || 100;
              const messages = await conversationDb.getMessages(sessionId, limit);
              res.json(success({ messages }));
          }));

         // 메시지 저장
         this.router.post('/:sessionId/messages', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
              const { sessionId } = req.params;
              const session = await conversationDb.getSession(sessionId);
              if (!hasSessionAccess(session, req)) {
                  res.status(403).json(forbidden('권한이 없습니다'));
                  return;
              }

              const { role, content, model, tokensUsed, responseTime } = req.body;
              // 입력 검증 — role 스푸핑('admin' 등)·통계 오염(음수/비정수 토큰) 방지
              if (role !== 'user' && role !== 'assistant' && role !== 'system') {
                  res.status(400).json(badRequest("role 은 'user' | 'assistant' | 'system' 이어야 합니다"));
                  return;
              }
              if (typeof content !== 'string') {
                  res.status(400).json(badRequest('content 는 문자열이어야 합니다'));
                  return;
              }
              if (tokensUsed != null && (!Number.isInteger(tokensUsed) || tokensUsed < 0)) {
                  res.status(400).json(badRequest('tokensUsed 는 0 이상의 정수여야 합니다'));
                  return;
              }
              if (responseTime != null && (typeof responseTime !== 'number' || !Number.isFinite(responseTime) || responseTime < 0)) {
                  res.status(400).json(badRequest('responseTime 은 0 이상의 숫자여야 합니다'));
                  return;
              }
              if (model != null && typeof model !== 'string') {
                  res.status(400).json(badRequest('model 은 문자열이어야 합니다'));
                  return;
              }
              const message = await conversationDb.saveMessage(sessionId, role, content, {
                  model, tokensUsed, responseTime
              });
              res.json(success({ message }));
          }));

         // 세션 제목 업데이트
         this.router.patch('/:sessionId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
              const { sessionId } = req.params;
              const session = await conversationDb.getSession(sessionId);
              if (!hasSessionAccess(session, req)) {
                  res.status(403).json(forbidden('권한이 없습니다'));
                  return;
              }

              const { title } = req.body;
              const updated = await conversationDb.updateSessionTitle(sessionId, title);
              res.json(success({ updated }));
          }));

         // 세션 삭제
         this.router.delete('/:sessionId', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
              const { sessionId } = req.params;
              const session = await conversationDb.getSession(sessionId);
              if (!hasSessionAccess(session, req)) {
                  res.status(403).json(forbidden('권한이 없습니다'));
                  return;
              }

              const deleted = await conversationDb.deleteSession(sessionId);
              historySummaryCache.invalidate(sessionId);
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
