/**
 * 사용자별 MCP 서버 클라이언트 풀.
 *
 * 자료구조: Map<userId, Map<serverId, ExternalMCPClient>>
 *
 * 동시성:
 *   - get/add/has 는 동기 (Map 연산)
 *   - remove/closeUser/closeAll 은 async (disconnect 호출)
 *   - 동일 (userId, serverId) 에 대한 동시 add 는 외부 (LifecycleSupervisor)
 *     의 책임으로 단일 진입점 보장 — 여기서는 race 방어 안 함
 *
 * 참조: docs/superpowers/plans/2026-05-20-phase7-lifecycle-supervisor.md §4
 */
import type { ExternalMCPClient } from './external-client';
import { createLogger } from '../utils/logger';

const logger = createLogger('UserMCPPool');

export class UserMCPPool {
    private pools = new Map<string, Map<string, ExternalMCPClient>>();

    has(userId: string, serverId: string): boolean {
        return this.pools.get(userId)?.has(serverId) === true;
    }

    get(userId: string, serverId: string): ExternalMCPClient | undefined {
        return this.pools.get(userId)?.get(serverId);
    }

    add(userId: string, serverId: string, client: ExternalMCPClient): void {
        let userPool = this.pools.get(userId);
        if (!userPool) {
            userPool = new Map();
            this.pools.set(userId, userPool);
        }
        userPool.set(serverId, client);
    }

    *forUser(userId: string): IterableIterator<[string, ExternalMCPClient]> {
        const userPool = this.pools.get(userId);
        if (!userPool) return;
        for (const entry of userPool.entries()) yield entry;
    }

    userIds(): IterableIterator<string> {
        return this.pools.keys();
    }

    async remove(userId: string, serverId: string): Promise<void> {
        const userPool = this.pools.get(userId);
        const client = userPool?.get(serverId);
        userPool?.delete(serverId);
        if (userPool && userPool.size === 0) this.pools.delete(userId);

        if (client) {
            try {
                await client.disconnect();
            } catch (e) {
                logger.warn(`disconnect 실패 (무시): user=${userId} server=${serverId}`, e);
            }
        }
    }

    async closeUser(userId: string): Promise<void> {
        const userPool = this.pools.get(userId);
        if (!userPool) return;
        const entries = [...userPool.entries()];
        this.pools.delete(userId);
        await Promise.all(entries.map(async ([serverId, client]) => {
            try {
                await client.disconnect();
            } catch (e) {
                logger.warn(`closeUser disconnect 실패: user=${userId} server=${serverId}`, e);
            }
        }));
    }

    async closeAll(): Promise<void> {
        const allUsers = [...this.pools.keys()];
        await Promise.all(allUsers.map(uid => this.closeUser(uid)));
    }

    size(): number {
        let total = 0;
        for (const userPool of this.pools.values()) total += userPool.size;
        return total;
    }
}

let _instance: UserMCPPool | null = null;
export function getUserMCPPool(): UserMCPPool {
    if (!_instance) _instance = new UserMCPPool();
    return _instance;
}
