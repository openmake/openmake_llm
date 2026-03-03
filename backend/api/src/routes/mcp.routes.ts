/**
 * ============================================================
 * MCP Routes - Model Context Protocol 관리 API 라우트
 * ============================================================
 *
 * MCP(Model Context Protocol) 설정 관리, 도구 목록 조회/실행,
 * 외부 MCP 서버 등록/연결/해제 등 MCP 생태계 전반을 관리합니다.
 * 도구 실행은 사용자 등급(tier) 기반 접근 제어를 적용합니다.
 *
 * @module routes/mcp.routes
 * @description
 * - POST   /api/mcp/terminal              - 터미널 실행 (비활성화, HTTP 410)
 * - POST   /api/mcp/terminal              - 터미널 실행 (비활성화, HTTP 410)
 * - GET    /api/mcp/tools                 - 사용 가능한 도구 목록 (등급별 필터링)
 * - POST   /api/mcp/tools/:name/execute   - 도구 실행 (인증, 컨텍스트 기반 권한)
 * - GET    /api/mcp/servers               - 외부 MCP 서버 목록 + 연결 상태 (인증)
 * - POST   /api/mcp/servers               - 새 외부 서버 등록 (관리자)
 * - DELETE /api/mcp/servers/:id           - 서버 제거 (관리자)
 * - POST   /api/mcp/servers/:id/connect   - 서버 수동 연결 (인증)
 * - POST   /api/mcp/servers/:id/disconnect - 서버 수동 연결 해제 (인증)
 * - GET    /api/mcp/servers/:id/status    - 서버 상태 조회 (인증)
 *
 * @requires UnifiedMCPClient - MCP 통합 클라이언트
 * @requires ServerRegistry - MCP 서버 레지스트리
 * @requires ToolRouter - 내장 + 외부 도구 라우터
 */

import { Router, Request, Response } from 'express';
import { getUnifiedMCPClient } from '../mcp';
import { requireAuth, optionalAuth } from '../auth';
import { success, badRequest, unauthorized, forbidden, notFound, internalError } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { getUnifiedDatabase } from '../data/models/unified-database';
import type { MCPTransportType } from '../mcp/types';
import { createLogger } from '../utils/logger';
import { validate } from '../middlewares/validation';
import { mcpToolExecuteSchema, mcpServerCreateSchema } from '../schemas/mcp.schema';

const logger = createLogger('McpRoutes');

// 라우터 생성
export const mcpRouter = Router();

 // 🔒 보안 패치 2026-02-07: 터미널 명령어 실행 엔드포인트 비활성화 (RCE 위험)
 // 🔒 보안 패치 2026-02-07: 터미널 명령어 실행 엔드포인트 비활성화 (RCE 위험)
 // runCommandTool이 제거되었으므로 이 엔드포인트도 비활성화
 mcpRouter.post('/terminal', requireAuth, (_req: Request, res: Response) => {
     res.status(410).json(badRequest('터미널 명령어 실행 기능은 보안상의 이유로 비활성화되었습니다'));
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
          logger.error('[MCP Tools] 목록 조회 실패:', error);
          res.status(500).json(internalError('도구 목록을 불러오는 중 오류가 발생했습니다'));
      }
 });

  // 도구 실행 (POST) - 사용자 컨텍스트 기반 권한 검증
  mcpRouter.post('/tools/:name/execute', requireAuth, validate(mcpToolExecuteSchema), asyncHandler(async (req: Request, res: Response) => {
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
  }));

 // ============================================
 // 🔌 외부 MCP 서버 관리 API
 // ============================================


  // 외부 서버 목록 + 연결 상태 (GET)
  mcpRouter.get('/servers', requireAuth, asyncHandler(async (req: Request, res: Response) => {
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
  }));

  // 새 외부 서버 등록 (POST) - admin 전용
  mcpRouter.post('/servers', requireAuth, validate(mcpServerCreateSchema), asyncHandler(async (req: Request, res: Response) => {
      if (req.user?.role !== 'admin') {
          res.status(403).json(forbidden('관리자만 서버를 등록할 수 있습니다'));
          return;
      }

      const { name, transport_type, command, args, env, url, enabled } = req.body as {
          name: string;
          transport_type: 'stdio' | 'sse' | 'streamable-http';
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          url?: string;
          enabled?: boolean;
      };
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
  }));

  // 서버 제거 (DELETE) - admin 전용
  mcpRouter.delete('/servers/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      if (req.user?.role !== 'admin') {
          res.status(403).json(forbidden('관리자만 서버를 삭제할 수 있습니다'));
          return;
      }

      const { id } = req.params;
      const db = getUnifiedDatabase();
      const registry = getUnifiedMCPClient().getServerRegistry();

      await registry.unregisterServer(id, db);
      res.json(success({ deleted: true }));
  }));

  // 서버 수동 연결 (POST)
  mcpRouter.post('/servers/:id/connect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const db = getUnifiedDatabase();
      const server = await db.getMcpServerById(id);

      if (!server) {
          res.status(404).json(notFound('서버'));
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
  }));

  // 서버 수동 연결 해제 (POST)
  mcpRouter.post('/servers/:id/disconnect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const registry = getUnifiedMCPClient().getServerRegistry();
      await registry.disconnectServer(id);

      res.json(success({ disconnected: true }));
  }));

  // 서버 상태 조회 (GET)
  mcpRouter.get('/servers/:id/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const registry = getUnifiedMCPClient().getServerRegistry();
      const status = registry.getServerStatus(id);

      if (!status) {
          // DB에서 서버 존재 확인
          const db = getUnifiedDatabase();
          const server = await db.getMcpServerById(id);
          if (!server) {
              res.status(404).json(notFound('서버'));
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
  }));
