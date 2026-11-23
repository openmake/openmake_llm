/**
 * 확장에 연결된 MCP 서버의 떠 있는 연결을 닫는다 — DB 를 고친 뒤(권한 철회·재승인, 확장 제거·업데이트)
 * 실행 중인 프로세스가 옛 설정·옛 버전으로 계속 돌지 않게 한다.
 *
 * 닫은 서버는 다음 사용 때 DB 의 새 설정으로 다시 뜨고, 꺼지거나 회수된(enabled=false·archived) 서버는
 * 다시 뜨지 않는다. 서버 소유자 = 확장 소유자(설치 때 createdBy). 실패해도 DB 변경은 유지한다 —
 * 호출자는 닫은 수만 응답·감사에 남긴다.
 *
 * @module services/extensions/release-linked-mcp
 */
import type { Pool } from 'pg';
import { UserExtensionPermissionRepository } from '../../data/repositories/user-extension-permission-repository';
import { getToolRuntime } from '../../runtime-ports/tool-runtime';
import { createLogger } from '../../utils/logger';

const log = createLogger('ReleaseLinkedMcp');

/** 확장에 연결된 MCP 서버 id — 링크를 끊는 회수(업데이트) 전에 받아 둘 때 쓴다 */
export async function listLinkedMcpServerIds(pool: Pool, extensionId: string): Promise<string[]> {
    return new UserExtensionPermissionRepository(pool).listLinkedMcpServerIds(extensionId);
}

/**
 * @param serverIds 미리 받아 둔 대상(링크가 이미 끊긴 경우). 없으면 지금 연결된 서버를 조회한다.
 * @returns 실제로 떠 있어서 닫은 서버 수(실패 시 0)
 */
export async function releaseLinkedMcpServers(
    pool: Pool,
    extensionId: string,
    ownerId: string,
    serverIds?: readonly string[],
): Promise<number> {
    try {
        const ids = serverIds ?? await listLinkedMcpServerIds(pool, extensionId);
        if (ids.length === 0) return 0;
        return await getToolRuntime().releaseServers(ownerId, ids);
    } catch (e) {
        log.warn(`확장 ${extensionId} 의 MCP 연결 정리 실패(DB 변경은 유지)`, e);
        return 0;
    }
}
