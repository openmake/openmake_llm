/**
 * MCP Routes
 * MCP (Model Context Protocol) 설정 및 도구 실행 API
 * 
 * - GET /settings - MCP 설정 조회
 * - PUT /settings - MCP 설정 저장
 * - POST /terminal - 터미널 명령어 실행 (관리자 전용)
 * - GET /tools - 사용 가능한 도구 목록
 * - POST /tools/:name/execute - 도구 실행
 * - GET /servers - 외부 MCP 서버 목록 + 연결 상태
 * - POST /servers - 새 외부 서버 등록 (admin)
 * - DELETE /servers/:id - 서버 제거 (admin)
 * - POST /servers/:id/connect - 서버 수동 연결
 * - POST /servers/:id/disconnect - 서버 수동 연결 해제
 * - GET /servers/:id/status - 서버 상태 조회
 */

import { Router, Request, Response } from 'express';
import { getUnifiedMCPClient } from '../mcp';
import { requireAuth, optionalAuth } from '../auth';
import { success, badRequest, unauthorized, forbidden, internalError } from '../utils/api-response';
import { getUnifiedDatabase } from '../data/models/unified-database';
import type { MCPTransportType } from '../mcp/types';

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
         const userTier = req.user?.tier || 'free';

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
         const user = req.user;

         if (!user) {
             res.status(401).json(unauthorized('인증이 필요합니다'));
             return;
         }

         // 사용자 컨텍스트 구성
         const context = {
             userId: user.id ?? 0,
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

 // ============================================
 // 🔌 외부 MCP 서버 관리 API
 // ============================================

 /** 유효한 transport 타입 */
 const VALID_TRANSPORTS: MCPTransportType[] = ['stdio', 'sse', 'streamable-http'];

 // 외부 서버 목록 + 연결 상태 (GET)
 mcpRouter.get('/servers', requireAuth, async (req: Request, res: Response) => {
     try {
         const db = getUnifiedDatabase();
         const servers = await db.getMcpServers();
         const registry = getUnifiedMCPClient().getServerRegistry();
         const statuses = registry.getAllStatuses();

         // DB 서버 목록에 연결 상태 병합
         const serversWithStatus = servers.map(server => {
             const status = statuses.find(s => s.serverId === server.id);
             return {
                 ...server,
                 connectionStatus: status?.status || 'disconnected',
                 toolCount: status?.toolCount || 0,
                 lastPing: status?.lastPing || null,
                 connectionError: status?.error || null,
             };
         });

         res.json(success({ servers: serversWithStatus, total: serversWithStatus.length }));
     } catch (error) {
         console.error('[MCP Servers] 목록 조회 실패:', error);
         res.status(500).json(internalError('서버 목록을 불러오는 중 오류가 발생했습니다'));
     }
 });

 // 새 외부 서버 등록 (POST) - admin 전용
 mcpRouter.post('/servers', requireAuth, async (req: Request, res: Response) => {
     try {
         if (req.user?.role !== 'admin') {
             res.status(403).json(forbidden('관리자만 서버를 등록할 수 있습니다'));
             return;
         }

         const { name, transport_type, command, args, env, url, enabled } = req.body;

         // 유효성 검사
         if (!name || typeof name !== 'string') {
             res.status(400).json(badRequest('서버 이름을 입력하세요'));
             return;
         }
         if (!transport_type || !VALID_TRANSPORTS.includes(transport_type)) {
             res.status(400).json(badRequest(`유효하지 않은 transport 타입입니다. 허용: ${VALID_TRANSPORTS.join(', ')}`));
             return;
         }
         if (transport_type === 'stdio' && !command) {
             res.status(400).json(badRequest('stdio transport에는 command가 필요합니다'));
             return;
         }
         if ((transport_type === 'sse' || transport_type === 'streamable-http') && !url) {
             res.status(400).json(badRequest(`${transport_type} transport에는 url이 필요합니다`));
             return;
         }

         const id = `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
         const config = {
             id,
             name: name.trim(),
             transport_type: transport_type as MCPTransportType,
             command: command || undefined,
             args: args || undefined,
             env: env || undefined,
             url: url || undefined,
             enabled: enabled !== false,
             created_at: new Date().toISOString(),
             updated_at: new Date().toISOString(),
         };

         const db = getUnifiedDatabase();
         const registry = getUnifiedMCPClient().getServerRegistry();
         const status = await registry.registerServer(config, db);

         res.status(201).json(success({ server: config, connectionStatus: status }));
     } catch (error) {
         const msg = error instanceof Error ? error.message : String(error);
         console.error('[MCP Servers] 등록 실패:', msg);

         // 중복 이름 에러 처리
         if (msg.includes('unique') || msg.includes('UNIQUE') || msg.includes('duplicate')) {
             res.status(409).json(badRequest('이미 동일한 이름의 서버가 등록되어 있습니다'));
         } else {
             res.status(500).json(internalError('서버 등록 중 오류가 발생했습니다'));
         }
     }
 });

 // 서버 제거 (DELETE) - admin 전용
 mcpRouter.delete('/servers/:id', requireAuth, async (req: Request, res: Response) => {
     try {
         if (req.user?.role !== 'admin') {
             res.status(403).json(forbidden('관리자만 서버를 삭제할 수 있습니다'));
             return;
         }

         const { id } = req.params;
         const db = getUnifiedDatabase();
         const registry = getUnifiedMCPClient().getServerRegistry();

         await registry.unregisterServer(id, db);
         res.json(success({ deleted: true }));
     } catch (error) {
         console.error('[MCP Servers] 삭제 실패:', error);
         res.status(500).json(internalError('서버 삭제 중 오류가 발생했습니다'));
     }
 });

 // 서버 수동 연결 (POST)
 mcpRouter.post('/servers/:id/connect', requireAuth, async (req: Request, res: Response) => {
     try {
         const { id } = req.params;
         const db = getUnifiedDatabase();
         const server = await db.getMcpServerById(id);

         if (!server) {
             res.status(404).json(badRequest('서버를 찾을 수 없습니다'));
             return;
         }

         const registry = getUnifiedMCPClient().getServerRegistry();
         await registry.connectServer(id, {
             id: server.id,
             name: server.name,
             transport_type: server.transport_type as MCPTransportType,
             command: server.command || undefined,
             args: server.args || undefined,
             env: server.env || undefined,
             url: server.url || undefined,
             enabled: server.enabled,
             created_at: server.created_at,
             updated_at: server.updated_at,
         });

         const status = registry.getServerStatus(id);
         res.json(success({ status }));
     } catch (error) {
         const msg = error instanceof Error ? error.message : String(error);
         console.error('[MCP Servers] 연결 실패:', msg);
         res.status(500).json(internalError(`서버 연결 실패: ${msg}`));
     }
 });

 // 서버 수동 연결 해제 (POST)
 mcpRouter.post('/servers/:id/disconnect', requireAuth, async (req: Request, res: Response) => {
     try {
         const { id } = req.params;
         const registry = getUnifiedMCPClient().getServerRegistry();
         await registry.disconnectServer(id);

         res.json(success({ disconnected: true }));
     } catch (error) {
         console.error('[MCP Servers] 연결 해제 실패:', error);
         res.status(500).json(internalError('서버 연결 해제 중 오류가 발생했습니다'));
     }
 });

 // 서버 상태 조회 (GET)
 mcpRouter.get('/servers/:id/status', requireAuth, async (req: Request, res: Response) => {
     try {
         const { id } = req.params;
         const registry = getUnifiedMCPClient().getServerRegistry();
         const status = registry.getServerStatus(id);

         if (!status) {
             // DB에서 서버 존재 확인
             const db = getUnifiedDatabase();
             const server = await db.getMcpServerById(id);
             if (!server) {
                 res.status(404).json(badRequest('서버를 찾을 수 없습니다'));
                 return;
             }
             // 존재하지만 연결 안 된 상태
             res.json(success({
                 status: {
                     serverId: id,
                     serverName: server.name,
                     status: 'disconnected',
                     toolCount: 0,
                 }
             }));
             return;
         }

         res.json(success({ status }));
     } catch (error) {
         console.error('[MCP Servers] 상태 조회 실패:', error);
         res.status(500).json(internalError('서버 상태를 조회하는 중 오류가 발생했습니다'));
     }
 });
