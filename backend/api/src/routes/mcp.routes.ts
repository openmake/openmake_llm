/**
 * MCP Routes
 * MCP (Model Context Protocol) 설정 및 도구 실행 API
 * 
 * - GET /settings - MCP 설정 조회
 * - PUT /settings - MCP 설정 저장
 * - POST /terminal - 터미널 명령어 실행 (관리자 전용)
 * - GET /tools - 사용 가능한 도구 목록
 * - POST /tools/:name/execute - 도구 실행
 */

import { Router, Request, Response } from 'express';
import { getUnifiedMCPClient } from '../mcp';
import { requireAuth, optionalAuth } from '../auth';
import { success, badRequest, unauthorized, forbidden, internalError } from '../utils/api-response';

// 라우터 생성
export const mcpRouter = Router();

// MCP 설정 조회 (GET) - 비로그인 사용자도 조회 가능
mcpRouter.get('/settings', optionalAuth, (req: Request, res: Response) => {
     try {
         const mcpClient = getUnifiedMCPClient();
         const settings = mcpClient.getFeatureState();
         res.json(success({ settings }));
     } catch (error) {
         console.error('[MCP Settings] 조회 실패:', error);
         res.status(500).json(internalError('설정을 불러오는 중 오류가 발생했습니다'));
     }
});

// MCP 설정 저장 (PUT) - 비로그인 사용자도 저장 가능 (글로벌 설정)
mcpRouter.put('/settings', optionalAuth, async (req: Request, res: Response) => {
    try {
        const newSettings = req.body;

         // 유효성 검사 (간단)
         if (!newSettings || typeof newSettings !== 'object') {
             res.status(400).json(badRequest('유효하지 않은 설정 데이터입니다'));
             return;
         }

         const mcpClient = getUnifiedMCPClient();
         await mcpClient.setFeatureState(newSettings);

         // 변경된 설정 반환
         const updatedSettings = mcpClient.getFeatureState();
         res.json(success({ settings: updatedSettings }));

     } catch (error) {
         console.error('[MCP Settings] 저장 실패:', error);
         res.status(500).json(internalError('설정을 저장하는 중 오류가 발생했습니다'));
     }
 });

 // 터미널 명령어 실행 (POST) - 화이트리스트 검사 등은 내부 Tool에서 처리
 mcpRouter.post('/terminal', requireAuth, async (req: Request, res: Response) => {
     try {
         const { command } = req.body;

         if (!command) {
             res.status(400).json(badRequest('명령어를 입력하세요'));
             return;
         }

        // 터미널 도구 직접 사용 (또는 UnifiedMCPClient 통해)
        // 여기서는 안전을 위해 runCommandTool을 바로 쓰지 않고, 
        // mcp/tools.ts의 handler를 호출하거나 별도 로직을 탈 수 있음.
        // 편의상 runCommandTool을 import해서 사용 (화이트리스트 주의)
        const { runCommandTool } = await import('../mcp/tools');

         // 권한 확인 (관리자만 가능하도록 할 수도 있음)
         if (req.user?.role !== 'admin') {
             res.status(403).json(forbidden('권한이 없습니다 (관리자 전용)'));
             return;
         }

         // 도구 실행
         const result = await runCommandTool.handler({ command });

         if (result.isError) {
             res.status(400).json(badRequest(result.content[0].text || '명령어 실행 실패'));
         } else {
             res.json(success({ stdout: result.content[0].text || '' }));
         }

     } catch (error) {
         console.error('[MCP Terminal] 실행 실패:', error);
         res.status(500).json(internalError('명령어 실행 중 오류가 발생했습니다'));
     }
 });

 // ============================================
 // 도구 목록 및 실행 API (등급별 접근 제어)
 // ============================================

 // 사용 가능한 도구 목록 조회 (GET) - 사용자 등급별 필터링
 mcpRouter.get('/tools', optionalAuth, (req: Request, res: Response) => {
     try {
         const mcpClient = getUnifiedMCPClient();
         const userTier = (req.user as any)?.tier || 'free';

         const tools = mcpClient.getToolListForUser(userTier);

         res.json(success({ tools, tier: userTier, total: tools.length }));
     } catch (error) {
         console.error('[MCP Tools] 목록 조회 실패:', error);
         res.status(500).json(internalError('도구 목록을 불러오는 중 오류가 발생했습니다'));
     }
 });

 // 도구 실행 (POST) - 사용자 컨텍스트 기반 권한 검증
 mcpRouter.post('/tools/:name/execute', requireAuth, async (req: Request, res: Response) => {
     try {
         const { name } = req.params;
         const { arguments: args = {} } = req.body;

         const mcpClient = getUnifiedMCPClient();
         const user = req.user as any;

         if (!user) {
             res.status(401).json(unauthorized('인증이 필요합니다'));
             return;
         }

         // 사용자 컨텍스트 구성
         const context = {
             userId: user.id,
             tier: user.tier || 'free',
             role: user.role || 'user'
         };

         // 권한 검증 후 도구 실행
         const result = await mcpClient.executeToolWithContext(name, args, context);

         if (result.isError) {
             res.status(403).json(forbidden(result.content[0].text || '도구 실행 권한이 없습니다'));
         } else {
             res.json(success({ result: result.content }));
         }

     } catch (error) {
         console.error('[MCP Tools] 실행 실패:', error);
         res.status(500).json(internalError('도구 실행 중 오류가 발생했습니다'));
     }
 });
