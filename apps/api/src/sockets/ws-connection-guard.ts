/**
 * ============================================================
 * WebSocket 연결 수락 제어 (admission control)
 * ============================================================
 * handler.ts 에서 분리 (파일 크기 가드 — 연결 수명주기와 별개 책임).
 * 책임: client IP 해석(신뢰 프록시 기반) · 연결 rate limit(IP/user) · user 연결 레지스트리 ·
 *       rate-limit Map 주기 정리. 상태(Map/interval)를 인스턴스로 소유 → handler 가 1개 compose.
 * config/timeouts(leaf)만 import → 순환 없음.
 *
 * @module sockets/ws-connection-guard
 */

import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { WS_LIMITS } from '../config/timeouts';
import { getConfig } from '../config';
import { ExtendedWebSocket } from './ws-types';

export class WsConnectionGuard {
    private userConnections: Map<string, Set<WebSocket>> = new Map();
    private ipConnectionAttempts: Map<string, number[]> = new Map();
    private userConnectionAttempts: Map<string, number[]> = new Map();
    private rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * 신뢰 프록시 설정이 있고 직접 연결 IP 가 신뢰 범위일 때만 X-Forwarded-For 사용.
     */
    getClientIp(req: IncomingMessage): string {
        const trustedProxies = getConfig().trustedProxies;
        const remoteAddr = req.socket?.remoteAddress || 'unknown';

        if (trustedProxies.length > 0 && this.isTrustedProxy(remoteAddr, trustedProxies)) {
            const xForwardedFor = req.headers['x-forwarded-for'];
            if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
                return xForwardedFor.split(',')[0].trim();
            }
            if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
                return xForwardedFor[0];
            }
        }

        return remoteAddr;
    }

    private isTrustedProxy(ip: string, trusted: string[]): boolean {
        if (trusted.includes('loopback') && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) {
            return true;
        }
        if (trusted.includes('linklocal') && (ip.startsWith('169.254.') || ip.startsWith('fe80:'))) {
            return true;
        }
        if (trusted.includes('uniquelocal')) {
            // RFC1918 IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 + IPv6 ULA fc00::/7
            if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('fc') || ip.startsWith('fd')) {
                return true;
            }
            // bug_003: 172.x는 두 번째 옥텟이 16-31 범위(/12)만 RFC1918 사설. 172.0.0.0/8 전체 매칭은 XFF 스푸핑 취약점
            const match172 = ip.match(/^172\.(\d+)\./);
            if (match172) {
                const second = parseInt(match172[1], 10);
                if (second >= 16 && second <= 31) {
                    return true;
                }
            }
        }
        return trusted.includes(ip);
    }

    private cleanupOldAttempts(map: Map<string, number[]>, key: string): number[] {
        const now = Date.now();
        const attempts = map.get(key) || [];
        const filtered = attempts.filter(ts => now - ts <= WS_LIMITS.CONNECTION_RATE_WINDOW_MS);
        map.set(key, filtered);
        return filtered;
    }

    private isRateLimited(map: Map<string, number[]>, key: string, maxAttempts: number): boolean {
        const attempts = this.cleanupOldAttempts(map, key);
        attempts.push(Date.now());
        map.set(key, attempts);
        return attempts.length > maxAttempts;
    }

    /** IP 기준 연결 시도 rate limit */
    isIpRateLimited(ip: string): boolean {
        return this.isRateLimited(this.ipConnectionAttempts, ip, WS_LIMITS.CONNECTION_RATE_MAX_PER_IP);
    }

    /** user 기준 연결 시도 rate limit */
    isUserRateLimited(userId: string): boolean {
        return this.isRateLimited(this.userConnectionAttempts, userId, WS_LIMITS.CONNECTION_RATE_MAX_PER_USER);
    }

    getActiveConnectionsForUser(userId: string): number {
        const connections = this.userConnections.get(userId);
        return connections ? connections.size : 0;
    }

    /** user 의 활성 ws 연결 Set (없으면 빈 Set) — 진행상황 relay(sendToUser) 용 */
    getUserConnections(userId: string): Set<WebSocket> {
        return this.userConnections.get(userId) ?? new Set();
    }

    registerUser(extWs: ExtendedWebSocket): void {
        const userId = extWs._authenticatedUserId;
        if (!userId) {
            return;
        }
        const existing = this.userConnections.get(userId) || new Set<WebSocket>();
        existing.add(extWs);
        this.userConnections.set(userId, existing);
    }

    /** user 레지스트리에서 연결 제거 (handler 가 clients.delete 후 호출) */
    unregisterUser(ws: WebSocket): void {
        const extWs = ws as ExtendedWebSocket;
        const userId = extWs._authenticatedUserId;
        if (!userId) {
            return;
        }
        const existing = this.userConnections.get(userId);
        if (!existing) {
            return;
        }
        existing.delete(ws);
        if (existing.size === 0) {
            this.userConnections.delete(userId);
        }
    }

    /**
     * Rate limit Map 주기적 정리 (60초 주기) — 윈도우 경과 항목 제거 + 크기 상한으로 메모리 DoS 방지.
     */
    startCleanup(): void {
        this.rateLimitCleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, attempts] of this.ipConnectionAttempts) {
                const filtered = attempts.filter(ts => now - ts <= WS_LIMITS.CONNECTION_RATE_WINDOW_MS);
                if (filtered.length === 0) {
                    this.ipConnectionAttempts.delete(key);
                } else {
                    this.ipConnectionAttempts.set(key, filtered);
                }
            }
            for (const [key, attempts] of this.userConnectionAttempts) {
                const filtered = attempts.filter(ts => now - ts <= WS_LIMITS.CONNECTION_RATE_WINDOW_MS);
                if (filtered.length === 0) {
                    this.userConnectionAttempts.delete(key);
                } else {
                    this.userConnectionAttempts.set(key, filtered);
                }
            }

            // Map 크기 제한: 메모리 고갈 DoS 방지
            const MAX_TRACKING_ENTRIES = 10000;
            for (const map of [this.ipConnectionAttempts, this.userConnectionAttempts]) {
                if (map.size > MAX_TRACKING_ENTRIES) {
                    const entriesToDelete = map.size - MAX_TRACKING_ENTRIES;
                    const iterator = map.keys();
                    for (let i = 0; i < entriesToDelete; i++) {
                        const key = iterator.next().value;
                        if (key) map.delete(key);
                    }
                }
            }
        }, WS_LIMITS.CONNECTION_RATE_WINDOW_MS);
        if (this.rateLimitCleanupInterval && typeof this.rateLimitCleanupInterval === 'object' && 'unref' in this.rateLimitCleanupInterval) {
            (this.rateLimitCleanupInterval as NodeJS.Timeout).unref();
        }
    }

    stopCleanup(): void {
        if (this.rateLimitCleanupInterval) {
            clearInterval(this.rateLimitCleanupInterval);
            this.rateLimitCleanupInterval = null;
        }
    }
}
