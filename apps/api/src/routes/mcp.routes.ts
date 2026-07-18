/**
 * ============================================================
 * MCP Routes - Model Context Protocol 관리 API 라우트
 * ============================================================
 *
 * MCP(Model Context Protocol) 설정 관리, 도구 목록 조회/실행,
 * 외부 MCP 서버 등록/연결/해제 등 MCP 생태계 전반을 관리합니다.
 * 모든 도구가 제한 없이 노출됩니다.
 *
 * @module routes/mcp.routes
 * @description
 * - POST   /api/mcp/terminal              - 터미널 실행 (비활성화, HTTP 410)
 * - POST   /api/mcp/terminal              - 터미널 실행 (비활성화, HTTP 410)
 * - GET    /api/mcp/tools                 - 사용 가능한 도구 목록 (전체 노출)
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
import type { MCPTransportType, MCPConnectionStatus } from '../mcp/types';
import { getLifecycleSupervisor } from '../mcp/lifecycle-supervisor';
import { createLogger } from '../utils/logger';
import { validate } from '../middlewares/validation';
import { mcpToolExecuteSchema, mcpServerCreateSchema } from '../schemas/mcp.schema';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import { canRegisterServer, canViewServer, canDeleteServer, canStartStopServer } from './mcp-visibility';
import { validateOutboundUrl } from '../security/ssrf-guard';

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
 // 도구 목록 및 실행 API
 // ============================================

 // 사용 가능한 도구 목록 조회 (GET) - 전체 노출 (제한 없음)
 mcpRouter.get('/tools', optionalAuth, (_req: Request, res: Response) => {
     try {
         const mcpClient = getUnifiedMCPClient();
         const tools = mcpClient.getToolList();

         res.json(success({ tools, total: tools.length }));
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
          role: user.role || 'user'
      };

      // 도구 실행
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
  // visibility 기반 필터: 본인 user_private + global + user_shared
  mcpRouter.get('/servers', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
      const allServers = await repo.listUserServers(userId);
      const filtered = allServers.filter(s => canViewServer(actor, s));

      // 이중 풀 통합:
      //   - global: server-registry.connections (admin 등록 서버)
      //   - user_private / user_shared: lifecycle-supervisor 의 UserMCPPool
      // 둘 다 조회해 effective status 산출 — userPool 우선 (사용자 server 가 global 과 id 충돌 시).
      const registry = getUnifiedMCPClient().getServerRegistry();
      const statuses = registry.getAllStatuses();
      const supervisor = getLifecycleSupervisor();
      const serversWithStatus = filtered.map(server => {
          const regStatus = statuses.find(s => s.serverId === server.id);
          let userStatus: MCPConnectionStatus | undefined;
          if (server.user_id && supervisor) {
              const client = supervisor.getUserClient(server.user_id, server.id);
              if (client) userStatus = client.getStatus();
          }
          const effective = userStatus || regStatus;
          return {
              ...server,
              connectionStatus: effective?.status || 'disconnected',
              toolCount: effective?.toolCount || 0,
              lastPing: effective?.lastPing || null,
              connectionError: effective?.error || null,
          };
      });

      res.json(success({ servers: serversWithStatus, total: serversWithStatus.length }));
  }));

  // 새 외부 서버 등록 (POST) — visibility 분기:
  //   global (admin) | user_private | user_shared (사용자는 카탈로그 템플릿만)
  mcpRouter.post('/servers', requireAuth, validate(mcpServerCreateSchema), asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const {
          name, transport_type, command, args, env, url, enabled,
          visibility = 'global', catalog_template_id,
      } = req.body as {
          name: string;
          transport_type: 'stdio' | 'sse' | 'streamable-http';
          command?: string;
          args?: string[];
          env?: Record<string, string>;
          url?: string;
          enabled?: boolean;
          visibility?: 'global' | 'user_private' | 'user_shared';
          catalog_template_id?: string;
      };

      const check = canRegisterServer(actor, { visibility, catalog_template_id });
      if (!check.allowed) {
          res.status(403).json(forbidden(check.reason));
          return;
      }

      // SSRF guard — sse/http URL 등록 시 외부 호스트 검증
      if ((transport_type === 'sse' || transport_type === 'streamable-http') && url) {
          try {
              await validateOutboundUrl(url);
          } catch (e) {
              res.status(400).json(badRequest(`URL 거부: ${e instanceof Error ? e.message : String(e)}`));
              return;
          }
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
      // global 만 즉시 spawn — user_* 는 Phase 7 lifecycle-supervisor 의 hook 으로 위임
      // (현재 phase 에서는 db.upsertMcpServer 동등 동작으로 fallback. registry.registerServer 는 connect 시도 포함.)
      const status = visibility === 'global'
          ? await registry.registerServer(config, db)
          : await registry.registerServer(config, db);
      // visibility / user_id / catalog_template_id 컬럼은 ALTER (023) 후 별도 update —
      // server-registry 의 db.addMcpServer 가 컬럼을 모를 수 있어 수동 UPDATE:
      if (visibility !== 'global') {
          await db.getPool().query(
              `UPDATE mcp_servers SET user_id = $1, visibility = $2, catalog_template_id = $3 WHERE id = $4`,
              [userId, visibility, catalog_template_id ?? null, id],
          );
      }

      res.status(201).json(success({ server: config, connectionStatus: status }));
  }));

  // 서버 제거 (DELETE) — 소유자 + admin
  mcpRouter.delete('/servers/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      const db = getUnifiedDatabase();
      const repo = new McpCatalogRepository(db.getPool());
      const server = await repo.getServerById(id);
      if (!server) {
          res.status(404).json(notFound('서버'));
          return;
      }
      if (!canDeleteServer(actor, server)) {
          res.status(403).json(forbidden('해당 서버를 삭제할 권한이 없습니다'));
          return;
      }
      // 유저 소유 서버는 유저풀에 spawn 된 클라이언트(샌드박스 컨테이너)도 함께 정리 —
      // registry.unregisterServer 는 전역 connections 만 해제하므로, 누락 시 삭제된 서버의
      // 컨테이너가 좀비로 남아 채팅이 구 자격증명(stale env)으로 계속 도구를 호출한다.
      if (server.user_id) {
          const supervisor = getLifecycleSupervisor();
          if (supervisor) {
              await supervisor.killUserServer(String(server.user_id), id).catch((e: unknown) =>
                  logger.warn(`서버 삭제 시 유저풀 정리 실패(삭제는 계속): ${id}: ${e instanceof Error ? e.message : String(e)}`));
          }
      }
      const registry = getUnifiedMCPClient().getServerRegistry();
      await registry.unregisterServer(id, db);
      res.json(success({ deleted: true }));
  }));

  // 서버 수동 연결 (POST) — 소유자 + admin
  mcpRouter.post('/servers/:id/connect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      {
          const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
          const server = await repo.getServerById(id);
          if (!server) {
              res.status(404).json(notFound('서버'));
              return;
          }
          if (!canStartStopServer(actor, server)) {
              res.status(403).json(forbidden('해당 서버를 연결할 권한이 없습니다'));
              return;
          }
      }
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

  // 서버 수동 연결 해제 (POST) — 소유자 + admin
  mcpRouter.post('/servers/:id/disconnect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      {
          const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
          const server = await repo.getServerById(id);
          if (!server) {
              res.status(404).json(notFound('서버'));
              return;
          }
          if (!canStartStopServer(actor, server)) {
              res.status(403).json(forbidden('해당 서버를 연결 해제할 권한이 없습니다'));
              return;
          }
      }
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
