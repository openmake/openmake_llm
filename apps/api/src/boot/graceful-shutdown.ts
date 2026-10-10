/**
 * ============================================================
 * Graceful Shutdown - 서버 종료 경로
 * ============================================================
 * 운영 진입점(`cli.js cluster`, PM2)과 직접 실행(`server.ts`)이 같은 종료 경로를 쓴다.
 * 종전에는 이 로직이 server.ts 의 직접 실행 블록 안에만 있어 운영에서는 SIGTERM·예외 핸들러가
 * 등록되지 않았다(cli 는 SIGINT 에 stop()+exit(0) 만 했다).
 *
 * 종료 순서:
 *   ⓪ 새 에이전트 작업 시작 차단(표시만 — 기다리지 않는다)
 *   ① 새 연결 수신 중단 + 진행 중 요청·WebSocket 정리(server.stop() — 끝날 때까지 기다린다)
 *   ② 실행 중 에이전트 작업 중단·정리 대기(상한 AGENT_TASK_DRAIN_TIMEOUT_MS) — 작업이 도구 런타임·DB 를 쓰므로 그 앞
 *   ③ 도구 런타임(외부 MCP 연결·사용자 풀)
 *   ④ 타이머류(OAuth 정리, Analytics, 스케줄러, TokenBlacklist) — 스케줄러 중지는 schedulers 가 건 주기 타이머를
 *      전부 멈춘다(뒤 단계가 Redis·DB 를 닫는 동안 발화해 닫힌 연결을 쓰지 않게)
 *   ⑤ Redis 연결(공용 Key-Value 저장소) — Redis 를 쓰는 요청 처리·에이전트 작업·스케줄러가 다 멈춘 뒤.
 *      메모리 백엔드(STORAGE_BACKEND=memory)에서는 아무 일도 하지 않는다
 *   ⑥ OpenTelemetry flush
 *   ⑦ DB 커넥션 풀 — 맨 마지막(앞 단계가 DB 를 쓸 수 있다)
 *
 * 실행 중인 에이전트 작업은 ②에서 멈춘다(services/agent-task/shutdown-drain): 사용자 취소가 아니라 부팅 복구가 집는
 * 표식(failed + 'server restarted')으로 남기고, 실행 소유권을 반납하고 샌드박스 컨테이너를 내린다(workspace 는 남긴다).
 * 다음 부팅의 복구(services/agent-task/boot-recovery)가 체크포인트에서 이어 실행한다. 상한 안에 정리가 끝나지 않은 작업과
 * 비정상 종료(SIGKILL·크래시)는 종전처럼 부팅 때의 좀비 정리·복구와 지난 소유권 점검이 맡는다.
 * 질문 응답 대기로 주차된 작업은 이 프로세스에 실행이 없어 건드리지 않는다.
 *
 * @module boot/graceful-shutdown
 */
import type { Server as HttpServer } from 'http';
import type { WebSocketServer } from 'ws';

/** 종료 전체 제한 시간. PM2 kill_timeout(ecosystem.config.js)은 이보다 길어야 한다. */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;

/** 진행 중 요청·WebSocket 이 스스로 끝나기를 기다리는 유예. 지나면 강제로 닫는다. */
export const SHUTDOWN_CONNECTION_GRACE_MS = 10000;

/**
 * 실행 중 에이전트 작업의 종료 정리(상태 기록·소유권 반납·컨테이너 정리)를 기다리는 상한. 지나면 다음 단계로 간다.
 * 전체 30초에서 연결 유예(최악 10초)를 빼면 20초 — 컨테이너 하나를 내리는 데 `docker stop -t 5` + rm 으로 보통 5~6초
 * (작업끼리는 병렬)이고 중단 신호가 LLM 호출·도구에 닿는 시간을 더해 12초를 준다. 남는 8초는 뒤 단계
 * (도구 런타임 정리·OTel flush·DB 풀 종료) 몫이다.
 */
export const AGENT_TASK_DRAIN_TIMEOUT_MS = 12000;

/** 종료 모듈이 쓰는 process 의 부분 — 테스트가 가짜를 주입한다 */
export interface ShutdownProcess {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    exit(code?: number): unknown;
}

export interface ShutdownStep {
    /** 로그에 쓰는 이름 */
    name: string;
    run: () => unknown;
}

export type GracefulShutdown = (signal: string, exitCode?: number) => Promise<void>;

/**
 * 새 연결 수신을 멈추고 열린 연결을 정리한다. http 서버가 완전히 닫히면 resolve 한다(reject 하지 않는다).
 *
 * - 유휴 keep-alive 연결은 바로 닫는다.
 * - 열린 WebSocket 은 1001(going away)로 닫는다 — 클라이언트 close 로 기존 정리 경로(sockets/handler)가 돈다.
 * - 진행 중 요청은 graceMs 동안 기다리고, 남으면 강제로 닫아 server.close 가 끝나게 한다.
 * - listen 하지 않은 서버(EADDRINUSE 경로)는 바로 끝난다.
 */
export function closeServerConnections(
    server: HttpServer,
    wss: WebSocketServer,
    graceMs: number = SHUTDOWN_CONNECTION_GRACE_MS,
): Promise<void> {
    return new Promise((resolve) => {
        const forceTimer = setTimeout(() => {
            for (const client of wss.clients) client.terminate();
            server.closeAllConnections();
        }, graceMs);
        server.close(() => {
            clearTimeout(forceTimer);
            resolve();
        });
        wss.close();
        for (const client of wss.clients) client.close(1001, 'server_shutdown');
        server.closeIdleConnections();
    });
}

/**
 * 단계를 순서대로 실행한 뒤 프로세스를 끝내는 종료 함수를 만든다.
 * 한 단계의 실패는 로그만 남기고 다음 단계로 간다.
 */
export function createGracefulShutdown(
    steps: readonly ShutdownStep[],
    options: { proc?: ShutdownProcess; timeoutMs?: number } = {},
): GracefulShutdown {
    const proc = options.proc ?? process;
    const timeoutMs = options.timeoutMs ?? GRACEFUL_SHUTDOWN_TIMEOUT_MS;

    let isShuttingDown = false;
    return async (signal: string, exitCode: number = 0): Promise<void> => {
        // 재진입 가드 — shutdown 중 발생하는 2차 unhandledRejection/추가 시그널로
        // 동일 정리 로직이 중복 실행(DB/MCP 이중 종료)되는 것을 방지.
        if (isShuttingDown) {
            console.log(`\n(이미 종료 진행 중 — '${signal}' 무시)`);
            return;
        }
        isShuttingDown = true;
        console.log(`\n👋 ${signal} 수신 — 서버 종료 중...`);

        let timedOut = false;
        const shutdownWork = async (): Promise<void> => {
            for (const step of steps) {
                if (timedOut) return;
                try {
                    await step.run();
                    console.log(`[Shutdown] ${step.name} 완료`);
                } catch (error) {
                    console.error(`[Shutdown] ${step.name} 중 오류:`, error);
                }
            }
        };

        // 전체 타임아웃: 종료 작업이 지연될 경우 강제 종료
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                timedOut = true;
                reject(new Error('Graceful shutdown timed out'));
            }, timeoutMs);
        });

        try {
            await Promise.race([shutdownWork(), timeoutPromise]);
        } catch (error) {
            console.error('[Shutdown] 종료 타임아웃 또는 오류 — 강제 종료:', error);
        } finally {
            clearTimeout(timer);
        }

        proc.exit(exitCode);
    };
}

/** 서버 프로세스의 종료 단계 — 순서가 곧 종료 순서다(모듈 주석 참고). */
function serverShutdownSteps(server: { stop(): Promise<void> }): ShutdownStep[] {
    return [
        {
            // 연결 정리를 기다리는 동안(최악 10초) 들어오는 요청·예약 발화·대기열의 다음 항목이 새 실행을 시작하지 않게
            name: '새 에이전트 작업 시작 차단',
            run: async () => {
                const { beginAgentTaskShutdown } = await import('../services/agent-task/shutdown-drain');
                beginAgentTaskShutdown();
            },
        },
        { name: '연결 수신 중단·진행 중 연결 정리', run: () => server.stop() },
        {
            // 도구 런타임·DB 풀을 닫기 전에 — 작업 루프와 그 종료 정리가 둘 다 쓴다
            name: '실행 중 에이전트 작업 정리',
            run: async () => {
                const { drainAgentTasksForShutdown } = await import('../services/agent-task/shutdown-drain');
                await drainAgentTasksForShutdown(AGENT_TASK_DRAIN_TIMEOUT_MS);
            },
        },
        {
            // 외부 MCP 서버 연결 해제와 사용자 풀 graceful kill
            name: '도구 런타임 정리',
            run: async () => {
                const { getToolRuntime } = await import('../runtime-ports/tool-runtime');
                await getToolRuntime().shutdown();
            },
        },
        {
            name: 'OAuth 정리 타이머 중지',
            run: async () => {
                const { stopOAuthCleanup } = await import('../controllers/auth.controller');
                stopOAuthCleanup();
            },
        },
        {
            name: 'Analytics 타이머 중지',
            run: async () => {
                const { getAnalyticsSystem } = await import('../monitoring/analytics');
                getAnalyticsSystem().dispose();
            },
        },
        {
            // ⚙️ P2-3: 모든 백그라운드 스케줄러 통합 중지
            name: '스케줄러 중지',
            run: async () => {
                const { stopAllSchedulers } = await import('../schedulers');
                stopAllSchedulers();
            },
        },
        {
            name: 'TokenBlacklist 타이머 중지',
            run: async () => {
                const { resetTokenBlacklist } = await import('../data/models/token-blacklist');
                resetTokenBlacklist();
            },
        },
        {
            // 공용 Key-Value 저장소(레이트 리미터·쿼터·OAuth state·캐시)의 Redis 연결 — 메모리 백엔드면 아무 일도 없다
            name: 'Redis 연결 종료',
            run: async () => {
                const { closeKeyValueStore } = await import('../storage');
                await closeKeyValueStore();
            },
        },
        {
            // OTel flush 보장
            name: 'OpenTelemetry 종료',
            run: async () => {
                const { shutdownTelemetry } = await import('../observability/otel');
                await shutdownTelemetry();
            },
        },
        {
            name: 'DB 커넥션 풀 종료',
            run: async () => {
                const { closeDatabase } = await import('../data/models/unified-database');
                await closeDatabase();
            },
        },
    ];
}

/**
 * 서버의 종료 처리와 전역 예외 핸들러를 등록한다. 서버 시작 전에 부른다.
 * SIGINT·SIGTERM 은 종료 코드 0, uncaughtException·unhandledRejection 은 1.
 */
export function installGracefulShutdown(
    server: { stop(): Promise<void> },
    proc: ShutdownProcess = process,
): GracefulShutdown {
    const gracefulShutdown = createGracefulShutdown(serverShutdownSteps(server), { proc });

    // 전역 예외 핸들러 등록 (프로세스 안정성)
    proc.on('uncaughtException', (err) => {
        console.error('[FATAL] uncaughtException:', err);
        // 비정상 상태이므로 graceful shutdown 후 종료
        void gracefulShutdown('uncaughtException', 1);
    });

    proc.on('unhandledRejection', (reason) => {
        console.error('[FATAL] unhandledRejection — graceful shutdown 시작:', reason);
        // 오염된 상태로 계속 실행하지 않고 graceful shutdown 후 PM2가 재시작
        void gracefulShutdown('unhandledRejection', 1);
    });

    proc.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
    proc.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

    return gracefulShutdown;
}
