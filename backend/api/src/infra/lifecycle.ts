/**
 * Lifecycle module - graceful shutdown and process error handlers
 *
 * Extracted from server.ts to consolidate shutdown orchestration
 * into a single module.
 */

import type { DashboardServer } from '../server';
import { clearSchedulerTimers } from './scheduler';

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;

/**
 * Perform graceful shutdown: clean up all resources then exit.
 */
async function gracefulShutdown(signal: string, server: DashboardServer): Promise<void> {
    console.log(`\n👋 ${signal} 수신 — 서버 종료 중...`);

    const shutdownWork = async () => {
        // 외부 MCP 서버 프로세스 정리
        try {
            const { getUnifiedMCPClient } = await import('../mcp');
            const registry = getUnifiedMCPClient().getServerRegistry();
            await registry.disconnectAll();
            console.log('[Shutdown] 모든 외부 MCP 서버 연결 해제 완료');
        } catch (error) {
            console.error('[Shutdown] 외부 MCP 서버 정리 중 오류:', error);
        }

        // DB 커넥션 풀 정상 종료
        try {
            const { closeDatabase } = await import('../data/models/unified-database');
            await closeDatabase();
            console.log('[Shutdown] DB 커넥션 풀 종료 완료');
        } catch (error) {
            console.error('[Shutdown] DB 커넥션 풀 종료 중 오류:', error);
        }

        // OAuth state 정리 타이머 중지
        try {
            const { stopOAuthCleanup } = await import('../routes/auth.routes');
            stopOAuthCleanup();
            console.log('[Shutdown] OAuth 정리 타이머 중지 완료');
        } catch (error) {
            console.error('[Shutdown] OAuth 정리 타이머 중지 중 오류:', error);
        }

        // Analytics 타이머 중지
        try {
            const { getAnalyticsSystem } = await import('../monitoring/analytics');
            getAnalyticsSystem().dispose();
            console.log('[Shutdown] Analytics 타이머 중지 완료');
        } catch (error) {
            console.error('[Shutdown] Analytics 타이머 중지 중 오류:', error);
        }

        // TokenBlacklist 타이머 정리
        try {
            const { resetTokenBlacklist } = await import('../data/models/token-blacklist');
            resetTokenBlacklist();
            console.log('[Shutdown] TokenBlacklist 타이머 중지 완료');
        } catch (error) {
            console.error('[Shutdown] TokenBlacklist 타이머 중지 중 오류:', error);
        }

        // 메모리/학습 스케줄러 타이머 정리
        clearSchedulerTimers();
        console.log('[Shutdown] 메모리/학습 스케줄러 타이머 정리 완료');

        // OpenTelemetry SDK 종료
        try {
            const { shutdownTelemetry } = await import('../observability/otel');
            await shutdownTelemetry();
            console.log('[Shutdown] OpenTelemetry 종료 완료');
        } catch (error) {
            console.error('[Shutdown] OpenTelemetry 종료 중 오류:', error);
        }

        server.stop();
    };

    // 30초 전체 타임아웃: 종료 작업이 지연될 경우 강제 종료
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Graceful shutdown timed out')), GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    });

    try {
        await Promise.race([shutdownWork(), timeoutPromise]);
    } catch (error) {
        console.error('[Shutdown] 종료 타임아웃 또는 오류 — 강제 종료:', error);
    }

    process.exit(0);
}

/**
 * Register process-level error handlers and shutdown signal listeners.
 */
export function registerProcessHandlers(server: DashboardServer): void {
    process.on('uncaughtException', (err) => {
        console.error('[FATAL] uncaughtException:', err);
        server.stop();
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, _promise) => {
        console.error('[FATAL] unhandledRejection:', reason);
    });

    process.on('SIGINT', () => gracefulShutdown('SIGINT', server));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
}
