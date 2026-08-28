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
import { classifyConnectError, parseConnectError } from '../mcp/connect-error';
import { validate } from '../middlewares/validation';
import { mcpToolExecuteSchema, mcpServerCreateSchema, mcpServerEnvUpdateSchema,
    mcpServerEnabledUpdateSchema, mcpServerAutoSpawnUpdateSchema } from '../schemas/mcp.schema';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import { McpOAuthRepository } from '../data/repositories/mcp-oauth-repository';
import { canRegisterServer, canViewServer, canDeleteServer, canStartStopServer, canUpdateServerEnv } from './mcp-visibility';
import { connectGlobalServer } from './mcp-global-connect';
import { getAuditService } from '../services/AuditService';
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

      // 연결에 실패한 client 는 풀에 남지 않아 메모리 상태가 비어 있다 — 그때 화면에
      // 원인 없는 "연결 안 됨"만 뜨던 것을 막기 위해 영속된 마지막 실패를 함께 싣는다.
      // 조회 실패는 무시(fail-open) — 부가 정보가 목록 자체를 죽이면 안 된다.
      const persistedErrors = await repo
          .getLatestConnectErrors(userId, filtered.map(s => s.id))
          .catch(() => new Map<string, { message: string; at: string }>());
      // OAuth 토큰 보유 여부 — 화면의 [로그인]/[로그아웃] 분기용. 조회 실패는 fail-open.
      const oauthConnected = await new McpOAuthRepository(getUnifiedDatabase().getPool())
          .listConnectedServerIds(userId, filtered.map(s => s.id))
          .catch(() => new Set<string>());

      const serversWithStatus = filtered.map(server => {
          const regStatus = statuses.find(s => s.serverId === server.id);
          let userStatus: MCPConnectionStatus | undefined;
          if (server.user_id && supervisor) {
              const client = supervisor.getUserClient(server.user_id, server.id);
              if (client) userStatus = client.getStatus();
          }
          const effective = userStatus || regStatus;
          // 살아있는 client 의 에러가 우선. 없을 때만 영속된 마지막 실패로 폴백한다
          // (연결된 서버에는 낡은 실패를 붙이지 않는다 — repo 쪽에서 이미 제외).
          const live = effective?.error ? classifyConnectError(new Error(effective.error)) : null;
          // 지금 연결돼 있으면 영속된 옛 오류(instances 이력)는 싣지 않는다 — 부팅 시 붙는 전역
          // 서버는 새 instance 행을 만들지 않아, 며칠 전 crashed 행이 "연결됨" 옆에 계속 보였다
          // (2026-08-27 점검: noapi-google-search 08-25 소유자 불일치 문구 잔존).
          const isConnected = effective?.status === 'connected';
          const stored = live || isConnected ? null : parseConnectError(persistedErrors.get(server.id)?.message);
          const failure = live ?? stored;
          return {
              ...server,
              connectionStatus: effective?.status || 'disconnected',
              toolCount: effective?.toolCount || 0,
              lastPing: effective?.lastPing || null,
              connectionError: failure?.message ?? null,
              /** 원인 코드 — 프론트가 i18n 문구로 바꿔 보여준다 (`auth_required` 등) */
              connectionErrorCode: failure?.code ?? null,
              connectionErrorAt: live || isConnected ? null : (persistedErrors.get(server.id)?.at ?? null),
              /** 원격 서버에 OAuth 토큰이 저장돼 있는가 (stdio 는 항상 false) */
              oauthConnected: oauthConnected.has(server.id),
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

      // 🔒 비-global(user_private/user_shared)은 body 의 임의 command/args/env 를 그대로 spawn 하는
      // RCE 경로이자 전역 ToolRouter 노출 경로다. 사용자 서버는 command 를 body 가 아닌 카탈로그
      // 템플릿에서만 취하는 POST /api/mcp/servers/from-catalog 로만 등록해야 한다. 이 레거시 라우트는
      // admin 이 관리하는 global 서버 등록 전용으로 제한한다.
      if (visibility !== 'global') {
          res.status(403).json(forbidden(
              '사용자 서버(user_private/user_shared)는 POST /api/mcp/servers/from-catalog 로 등록하세요 (임의 stdio command 금지)',
          ));
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
      // 여기 도달하면 visibility === 'global' (admin) — 즉시 spawn(connect 포함).
      const status = await registry.registerServer(config, db);

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

  // env(자격증명) 교체 (PATCH) — 소유자 + admin.
  // 로테이션 전용 부분 갱신: 전달한 키만 바뀌고 나머지는 보존된다. secret 값은 저장 시
  // 암호화(v1:)되며 응답에는 마스킹된 env 만 실린다.
  /**
   * PATCH /api/mcp/servers/:id/enabled  { enabled }
   * 서버 사용 여부 토글 — 삭제의 **되돌릴 수 있는** 대안.
   *
   * 연결이 구조적으로 불가능한 서버(예: OAuth 를 요구하는 원격 MCP)를 목록에서 치우되
   * 설정·자격증명은 보존한다. 끄면 살아있는 client 도 함께 정리한다 — 안 그러면 "사용 안 함"
   * 으로 표시되면서 도구는 계속 제공되는 모순이 생긴다.
   */
  mcpRouter.patch('/servers/:id/enabled', requireAuth, validate(mcpServerEnabledUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      const { enabled } = req.body as { enabled: boolean };

      const db = getUnifiedDatabase();
      const repo = new McpCatalogRepository(db.getPool());
      const server = await repo.getServerById(id);
      if (!server) {
          res.status(404).json(notFound('서버'));
          return;
      }
      // 실행 제어와 같은 성격의 권한이라 연결/해제와 동일한 판정을 쓴다.
      if (!canStartStopServer(actor, server)) {
          res.status(403).json(forbidden('해당 서버를 변경할 권한이 없습니다'));
          return;
      }

      await repo.setServerEnabled(id, enabled);

      if (!enabled && server.user_id) {
          const supervisor = getLifecycleSupervisor();
          if (supervisor) {
              await supervisor.killUserServer(String(server.user_id), id).catch((e: unknown) =>
                  logger.warn(`사용 안 함 전환 시 정리 실패(전환은 유지): ${id}: ${e instanceof Error ? e.message : String(e)}`));
          }
      }

      res.json(success({ id, enabled }));
  }));

  /**
   * PATCH /api/mcp/servers/:id/auto-spawn  { auto_spawn }
   * 자동 연결 토글 — 사용자 소유 서버 전용(전역은 부팅 시 registry 가 띄우므로 이 축이 없다).
   *
   * 켜면 다음 로그인/채팅 시작을 기다리지 않고 바로 spawn 을 시도한다(from-catalog 설치와
   * 같은 규칙). spawn 실패는 토글 결과를 뒤집지 않는다 — 실패 원인은 instance 이력에 남아
   * 목록의 connectionError 로 보이고, 다음 ensureUserServers 가 멱등 재시도한다.
   */
  mcpRouter.patch('/servers/:id/auto-spawn', requireAuth, validate(mcpServerAutoSpawnUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      const { auto_spawn: autoSpawn } = req.body as { auto_spawn: boolean };

      const db = getUnifiedDatabase();
      const repo = new McpCatalogRepository(db.getPool());
      const server = await repo.getServerById(id);
      if (!server) {
          res.status(404).json(notFound('서버'));
          return;
      }
      if (!server.user_id) {
          res.status(400).json(badRequest('전역 서버는 부팅 시 자동 연결됩니다 — 자동 연결 토글 대상이 아닙니다'));
          return;
      }
      if (!canStartStopServer(actor, server)) {
          res.status(403).json(forbidden('해당 서버를 변경할 권한이 없습니다'));
          return;
      }

      await repo.setServerAutoSpawn(id, autoSpawn);

      let spawned = false;
      if (autoSpawn && server.enabled) {
          const supervisor = getLifecycleSupervisor();
          if (supervisor) {
              try {
                  await supervisor.spawnUserServer(String(server.user_id), id);
                  spawned = true;
              } catch (e: unknown) {
                  logger.warn(`자동 연결 켜기 직후 spawn 실패(토글은 유지): ${id}: ${e instanceof Error ? e.message : String(e)}`);
              }
          }
      }

      res.json(success({ id, auto_spawn: autoSpawn, spawned }));
  }));

  mcpRouter.patch('/servers/:id/env', requireAuth, validate(mcpServerEnvUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      const { env } = req.body as { env: Record<string, string> };

      const db = getUnifiedDatabase();
      const repo = new McpCatalogRepository(db.getPool());
      const server = await repo.getServerById(id);
      if (!server) {
          res.status(404).json(notFound('서버'));
          return;
      }
      if (!canUpdateServerEnv(actor, server)) {
          res.status(403).json(forbidden('해당 서버의 환경변수를 변경할 권한이 없습니다'));
          return;
      }

      const template = server.catalog_template_id
          ? await repo.getCatalogTemplate(server.catalog_template_id)
          : null;

      let updated;
      try {
          updated = await repo.updateEnv(id, env, template);
      } catch (e) {
          // updateEnv 는 허용되지 않은 키에 대해 throw — 클라이언트 입력 오류이므로 400.
          res.status(400).json(badRequest(e instanceof Error ? e.message : '환경변수 변경에 실패했습니다'));
          return;
      }
      if (!updated) {
          res.status(404).json(notFound('서버'));
          return;
      }

      // 이미 떠 있는 클라이언트는 구 자격증명(stale env)을 그대로 들고 있다. 정리하지 않으면
      // 키를 바꿔도 옛 값으로 계속 도구를 호출한다(삭제 경로와 동일한 이유).
      // 소유 주체에 따라 붙어 있는 풀이 다르므로 양쪽 모두 끊어야 한다 —
      //   user 소유: userPool(lifecycle-supervisor) → 다음 ensureUserServers 가 멱등 respawn
      //   global   : 전역 registry → 자동 respawn 경로가 없어 수동 [연결] 이 필요
      // 어느 쪽이든 "다시 연결해야 새 값이 적용된다"는 뜻이므로 respawnRequired=true 로 알린다.
      let respawnRequired = false;
      if (server.user_id) {
          const supervisor = getLifecycleSupervisor();
          if (supervisor) {
              respawnRequired = true;
              await supervisor.killUserServer(String(server.user_id), id).catch((e: unknown) =>
                  logger.warn(`env 변경 후 유저풀 정리 실패(변경은 유지): ${id}: ${e instanceof Error ? e.message : String(e)}`));
          }
      } else {
          respawnRequired = true;
          await getUnifiedMCPClient().getServerRegistry().disconnectServer(id).catch((e: unknown) =>
              logger.warn(`env 변경 후 전역 registry 정리 실패(변경은 유지): ${id}: ${e instanceof Error ? e.message : String(e)}`));
      }

      // 자격증명 변경은 감사 대상 — 키 이름만 남기고 값은 절대 기록하지 않는다.
      void getAuditService().logAudit({
          action: 'mcp_server_env_update',
          userId,
          resourceType: 'mcp_server',
          resourceId: id,
          details: { serverName: server.name, keys: Object.keys(env) },
      }).catch(() => { /* audit 실패는 응답에 영향 없음 */ });

      res.json(success({ server: updated, respawnRequired }));
  }));

  // 서버 수동 연결 (POST) — 소유자 + admin
  mcpRouter.post('/servers/:id/connect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
      const target = await repo.getServerById(id);
      if (!target) {
          res.status(404).json(notFound('서버'));
          return;
      }
      if (!canStartStopServer(actor, target)) {
          res.status(403).json(forbidden('해당 서버를 연결할 권한이 없습니다'));
          return;
      }

      // 🔒 user 소유 서버는 전역 registry 가 아니라 소유자의 userPool 로 띄운다.
      //    registry 로 띄우면 tool-router 의 전역 externalTools fallback
      //    (visibility=global 전용)에 도구가 등록돼 **다른 사용자도 그 도구를 실행**할 수
      //    있다(= 남의 자격증명으로 접근하는 데이터가 유출). 부팅 로드 경로에는 이미
      //    visibility 필터가 있었으나 이 수동 경로만 우회하고 있었다.
      //    부수 효과로 자동 spawn(userPool)과 풀이 일치해 컨테이너 중복도 사라진다.
      if (target.visibility !== 'global') {
          const supervisor = getLifecycleSupervisor();
          if (!supervisor) {
              res.status(503).json(internalError('MCP lifecycle supervisor 가 초기화되지 않았습니다'));
              return;
          }
          const ownerId = String(target.user_id ?? userId);
          const client = await supervisor.spawnUserServer(ownerId, id);
          res.json(success({ status: client.getStatus() }));
          return;
      }

      // 전역 서버 — /start 와 공유하는 registry 연결(복호화 포함). mcp-global-connect.ts 참고.
      const status = await connectGlobalServer(id);
      if (status === null) {
          res.status(404).json(notFound('서버'));
          return;
      }
      res.json(success({ status }));
  }));

  // 서버 수동 연결 해제 (POST) — 소유자 + admin
  mcpRouter.post('/servers/:id/disconnect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const userId = String(req.user?.id ?? '');
      const role = req.user?.role ?? 'user';
      const actor = { id: userId, role };
      const { id } = req.params;
      const repo = new McpCatalogRepository(getUnifiedDatabase().getPool());
      const target = await repo.getServerById(id);
      if (!target) {
          res.status(404).json(notFound('서버'));
          return;
      }
      if (!canStartStopServer(actor, target)) {
          res.status(403).json(forbidden('해당 서버를 연결 해제할 권한이 없습니다'));
          return;
      }

      // connect 와 대칭 — user 소유 서버는 userPool 에 떠 있으므로 registry 만 정리하면
      // 컨테이너가 살아남아 "해제했는데 계속 동작"하게 된다.
      if (target.visibility !== 'global') {
          const supervisor = getLifecycleSupervisor();
          if (supervisor) {
              // 정리 실패로 500 을 내지 않는다 — PATCH/DELETE 경로와 동일하게 경고만 남기고
              // 나머지 정리를 계속한다(해제 요청 자체는 최대한 진행시키는 편이 낫다).
              await supervisor.killUserServer(String(target.user_id ?? userId), id).catch((e: unknown) =>
                  logger.warn(`연결 해제 시 유저풀 정리 실패: ${id}: ${e instanceof Error ? e.message : String(e)}`));
          }
          // 과거 경로로 registry 에 등록됐을 수 있으니 함께 정리(멱등).
          await getUnifiedMCPClient().getServerRegistry().disconnectServer(id).catch(() => { /* 미등록이면 무시 */ });
          res.json(success({ disconnected: true }));
          return;
      }

      const registry = getUnifiedMCPClient().getServerRegistry();
      await registry.disconnectServer(id);

      res.json(success({ disconnected: true }));
  }));

  // 서버 상태 조회 (GET)
  mcpRouter.get('/servers/:id/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const registry = getUnifiedMCPClient().getServerRegistry();
      const regStatus = registry.getServerStatus(id);

      // ⚠️ 사용자 소유 서버는 전역 registry 가 아니라 userPool 에 뜬다 — registry 만 보면
      // 실제로 연결돼 도구가 등록된 서버도 늘 disconnected/toolCount:0 으로 보고된다
      // (목록 API 는 이미 supervisor 를 함께 본다. 이중 풀은 양쪽 대칭이 원칙).
      const db = getUnifiedDatabase();
      const server = await db.getMcpServerById(id);
      if (!server) {
          res.status(404).json(notFound('서버'));
          return;
      }

      let userStatus: MCPConnectionStatus | undefined;
      const supervisor = getLifecycleSupervisor();
      if (server.user_id && supervisor) {
          const client = supervisor.getUserClient(String(server.user_id), id);
          if (client) userStatus = client.getStatus();
      }

      const effective = userStatus || regStatus;
      res.json(success({
          status: effective ?? {
              serverId: id,
              serverName: server.name,
              status: 'disconnected',
              toolCount: 0,
          },
      }));
  }));
