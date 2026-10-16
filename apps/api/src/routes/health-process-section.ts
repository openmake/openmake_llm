/**
 * /api/health 의 관리자 전용 process 필드 — 부하 harness(scripts/bench/api-load.mjs)가
 * 같은 프로세스의 RSS 를 바이트 단위로 표본하고, pid 로 측정 중 재시작을 알아챈다.
 * 공개 응답의 services.memory.rssMB(MiB 정수)는 그대로 둔다 — 비관리자 응답은 바뀌지 않는다.
 */
import type { Request } from 'express';
import { isAdmin } from '../auth/auth-core';

export interface HealthProcessSection {
    pid: number;
    rss: number;
    heapUsed: number;
    uptimeSec: number;
}

export function readHealthProcessSection(
    req: Pick<Request, 'user'>,
    mem: NodeJS.MemoryUsage = process.memoryUsage(),
): HealthProcessSection | undefined {
    const role = req.user?.role;
    if (!role || !isAdmin(role)) return undefined;
    return { pid: process.pid, rss: mem.rss, heapUsed: mem.heapUsed, uptimeSec: Math.round(process.uptime()) };
}
