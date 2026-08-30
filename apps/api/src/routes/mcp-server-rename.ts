/**
 * MCP 서버 이름 변경 핸들러 — `PATCH /api/mcp/servers/:id`.
 *
 * 이름은 곧 **도구 네임스페이스**(`name::tool`)이자 tool-merger 의 의도 매칭 키다. 같은
 * 카탈로그 템플릿을 여러 접속처(예: 앱 DB용 / 분석 DB용 postgres)에 설치할 때 서로 구분하는
 * 유일한 수단이라, 설치 후에도 바꿀 수 있어야 한다.
 *
 * `mcp.routes.ts` 가 600줄 가드에 닿아 라우트 본문만 여기로 분리했다(등록은 그쪽).
 *
 * ⚠️ 네임스페이스는 **spawn 시점에 굳는다** — 이름만 바꾸고 떠 있는 클라이언트를 두면 구
 * 이름으로 도구가 계속 노출된다. 그래서 env 변경과 같은 이유로 풀/registry 에서 내려
 * 다음 ensureUserServers 가 새 이름으로 respawn 하게 한다(`respawnRequired`).
 *
 * @module routes/mcp-server-rename
 */
import type { Request, Response } from 'express';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { McpCatalogRepository } from '../data/repositories/mcp-catalog-repository';
import { getUnifiedMCPClient } from '../mcp';
import { getLifecycleSupervisor } from '../mcp/lifecycle-supervisor';
import { getAuditService } from '../services/AuditService';
import { canUpdateServerEnv } from './mcp-visibility';
import { success, notFound, forbidden, badRequest } from '../utils/api-response';
import { createLogger } from '../utils/logger';

const logger = createLogger('McpServerRename');

/** 소유자 + admin 만 변경 가능(env 변경과 동일 기준 — 공유 대상자는 바꿀 수 없다). */
export async function renameMcpServer(req: Request, res: Response): Promise<void> {
    const userId = String(req.user?.id ?? '');
    const role = req.user?.role ?? 'user';
    const actor = { id: userId, role };
    const { id } = req.params;
    const { name } = req.body as { name: string };

    const db = getUnifiedDatabase();
    const repo = new McpCatalogRepository(db.getPool());
    const server = await repo.getServerById(id);
    if (!server) {
        res.status(404).json(notFound('서버'));
        return;
    }
    if (!canUpdateServerEnv(actor, server)) {
        res.status(403).json(forbidden('해당 서버의 이름을 변경할 권한이 없습니다'));
        return;
    }
    if (server.name === name) {
        res.json(success({ server, respawnRequired: false }));
        return;
    }

    let updated;
    try {
        updated = await repo.updateName(id, name);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // uniq_mcp_servers_user_name / uniq_mcp_servers_global_name 위반.
        if (/duplicate key|unique/i.test(msg)) {
            res.status(409).json(badRequest(`이미 "${name}" 이름의 서버가 있습니다`));
            return;
        }
        throw e;
    }
    if (!updated) {
        res.status(404).json(notFound('서버'));
        return;
    }

    let respawnRequired = false;
    if (server.user_id) {
        const supervisor = getLifecycleSupervisor();
        if (supervisor) {
            respawnRequired = true;
            await supervisor.killUserServer(String(server.user_id), id).catch((e: unknown) =>
                logger.warn(`이름 변경 후 유저풀 정리 실패(변경은 유지): ${id}: ${e instanceof Error ? e.message : String(e)}`));
        }
    } else {
        respawnRequired = true;
        await getUnifiedMCPClient().getServerRegistry().disconnectServer(id).catch((e: unknown) =>
            logger.warn(`이름 변경 후 전역 registry 정리 실패(변경은 유지): ${id}: ${e instanceof Error ? e.message : String(e)}`));
    }

    void getAuditService().logAudit({
        action: 'mcp_server_rename',
        userId,
        resourceType: 'mcp_server',
        resourceId: id,
        details: { from: server.name, to: name },
    }).catch(() => { /* audit 실패는 응답에 영향 없음 */ });

    res.json(success({ server: updated, respawnRequired }));
}
