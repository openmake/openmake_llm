/**
 * Discord gateway bot 설정 — 전부 환경변수에서 로드 (No-Hardcoding 정책 L1/L2).
 * 접근 제어 키 체계:
 *   DISCORD_ALLOWED_USERS / DISCORD_ALLOWED_ROLES / DISCORD_ALLOW_ALL_USERS
 *   DISCORD_REQUIRE_MENTION / DISCORD_FREE_RESPONSE_CHANNELS
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

// apps/api/src/server.ts 와 동일하게 레포 루트 .env 를 로드
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true } as dotenv.DotenvConfigOptions);

function parseList(value: string | undefined): string[] {
    return (value || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined || value === '') return defaultValue;
    return value.toLowerCase() === 'true';
}

function parseIntEnv(value: string | undefined, defaultValue: number): number {
    const n = parseInt(value || '', 10);
    return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

/** parseIntEnv 와 같되 0 을 유효한 값으로 받는다 ("끔"을 0 으로 표현하는 항목용). */
function parseNonNegativeIntEnv(value: string | undefined, defaultValue: number): number {
    const n = parseInt(value || '', 10);
    return Number.isFinite(n) && n >= 0 ? n : defaultValue;
}

/** 작업 상태 조회 간격의 하한(ms) — 더 작은 값은 서버를 초당 수십 번 두드린다 */
const TASK_POLL_MIN_MS = 1_000;

export function parseTaskPollMs(value: string | undefined): number {
    return Math.max(TASK_POLL_MIN_MS, parseIntEnv(value, 5_000));
}

export type TaskExecutor = 'sandbox' | 'local';
export type TaskApprovalPolicy = 'all' | 'high-risk' | 'none';

/** PURE: 작업 실행 위치 — local 만 그대로, 그 밖(오타 포함)은 서버 격리 환경 */
export function parseTaskExecutor(value: string | undefined): TaskExecutor {
    return value === 'local' ? 'local' : 'sandbox';
}

/** PURE: 승인 방식 — 모르는 값은 가장 엄격한 all(전부 승인)로 */
export function parseTaskApprovalPolicy(value: string | undefined): TaskApprovalPolicy {
    return value === 'high-risk' || value === 'none' ? value : 'all';
}

/**
 * 서버에서 받아온 설정을 덮어쓸 수 있도록 mutable 로 둔다 — 값 해석 우선순위는
 * **서버(system_settings DB > 서버 .env) > 봇 프로세스 .env > 기본값**.
 * `applyRemoteSettings` 는 기동 시 1회만 호출한다(런타임 중 변경은 재시작으로 반영).
 */
export const config = {
    /** Discord Developer Portal 에서 발급한 bot token (필수) */
    botToken: process.env.DISCORD_BOT_TOKEN || '',

    /** openmake_llm 백엔드 (OpenAI 호환 v1 경로의 origin) */
    apiBaseUrl: process.env.DISCORD_BOT_API_BASE_URL || 'http://127.0.0.1:52416',
    /** openmake_llm API Key (omk_live_...) — /api/v1/* 인증 (필수) */
    apiKey: process.env.DISCORD_BOT_API_KEY || '',
    /** 사용할 모델 id. 미설정 시 GET /api/v1/models 첫 항목 사용 */
    model: process.env.DISCORD_BOT_MODEL || '',
    /** 백엔드 한 턴 응답 제한 시간(ms, 기본 10분) — 로컬 모델은 긴 산출물에 5분 이상 걸릴 수 있음 */
    requestTimeoutMs: parseIntEnv(process.env.DISCORD_BOT_REQUEST_TIMEOUT_MS, 600_000),

    // ── 접근 제어 ─────────────────────────────
    allowAllUsers: parseBool(process.env.DISCORD_ALLOW_ALL_USERS, false),
    allowedUsers: parseList(process.env.DISCORD_ALLOWED_USERS),
    allowedRoles: parseList(process.env.DISCORD_ALLOWED_ROLES),
    requireMention: parseBool(process.env.DISCORD_REQUIRE_MENTION, true),
    freeResponseChannels: parseList(process.env.DISCORD_FREE_RESPONSE_CHANNELS),

    // ── 봇끼리 대화 (기본 꺼짐) ───────────────────────────────
    /** 메시지를 받아 줄 다른 봇의 사용자 id 목록. 비어 있으면 봇 메시지를 모두 무시한다 */
    allowedBotIds: parseList(process.env.DISCORD_ALLOWED_BOT_IDS),
    /** 사람 메시지 없이 봇에게 연속으로 답하는 횟수 상한 (채널별) */
    botExchangeMax: parseIntEnv(process.env.DISCORD_BOT_EXCHANGE_MAX, 4),

    // ── 에이전트 작업 (/task, 기본 꺼짐) ───────────────────────
    /** /task 를 쓸 수 있는 디스코드 사용자 id 목록. 비어 있으면 기능 꺼짐(명령도 등록하지 않는다) */
    taskAllowedUsers: parseList(process.env.DISCORD_TASK_ALLOWED_USERS),
    /** 작업 실행 위치 — sandbox(서버 격리 환경) | local(Companion 이 연결된 기기) */
    taskExecutor: parseTaskExecutor(process.env.DISCORD_TASK_EXECUTOR),
    /** 이 봇이 시작한 작업의 승인 방식 — all(전부 승인) | high-risk | none */
    taskApprovalPolicy: parseTaskApprovalPolicy(process.env.DISCORD_TASK_APPROVAL_POLICY),
    /** 작업 상태 조회 간격(ms) — 1초 아래로는 내려가지 않는다 */
    taskPollMs: parseTaskPollMs(process.env.DISCORD_TASK_POLL_MS),
    /** 한 작업을 지켜보는 최대 시간(ms) — 넘으면 지켜보기만 끝낸다(작업은 계속 돈다) */
    taskWatchMaxMs: parseIntEnv(process.env.DISCORD_TASK_WATCH_MAX_MS, 2 * 60 * 60 * 1000),

    // ── 세션 (사용자별 격리, /reset 까지 유지) ─────────────────
    /** 세션당 보관할 최대 대화 턴 수 (user+assistant 쌍) */
    sessionMaxTurns: parseIntEnv(process.env.DISCORD_SESSION_MAX_TURNS, 20),
};

/**
 * 서버가 내려준 설정을 적용한다(관리자 화면 입력값). 빈 값·미지 키는 무시해 .env 설정을 지우지 않는다.
 * @returns 실제로 덮어쓴 키 목록 (로그용 — 값은 남기지 않는다)
 */
export function applyRemoteSettings(settings: Record<string, string>): string[] {
    const applied: string[] = [];
    const take = (key: string, assign: (value: string) => void): void => {
        const value = settings[key];
        if (typeof value !== 'string' || value.trim() === '') return;
        assign(value.trim());
        applied.push(key);
    };
    take('DISCORD_BOT_TOKEN', (v) => { config.botToken = v; });
    take('DISCORD_BOT_MODEL', (v) => { config.model = v; });
    take('DISCORD_BOT_REQUEST_TIMEOUT_MS', (v) => { config.requestTimeoutMs = parseIntEnv(v, config.requestTimeoutMs); });
    take('DISCORD_ALLOW_ALL_USERS', (v) => { config.allowAllUsers = parseBool(v, config.allowAllUsers); });
    take('DISCORD_ALLOWED_USERS', (v) => { config.allowedUsers = parseList(v); });
    take('DISCORD_ALLOWED_ROLES', (v) => { config.allowedRoles = parseList(v); });
    take('DISCORD_REQUIRE_MENTION', (v) => { config.requireMention = parseBool(v, config.requireMention); });
    take('DISCORD_FREE_RESPONSE_CHANNELS', (v) => { config.freeResponseChannels = parseList(v); });
    take('DISCORD_SESSION_MAX_TURNS', (v) => { config.sessionMaxTurns = parseIntEnv(v, config.sessionMaxTurns); });
    return applied;
}

/**
 * 서버(openmake_llm)에서 이 봇의 운영 설정을 받아온다 — 관리자 화면(system_settings)에서
 * 입력한 값이 여기로 온다. 인증은 `DISCORD_BOT_API_KEY`(discord 스코프).
 * 서버 부팅·전체 재시작 때는 봇이 백엔드보다 먼저 뜨므로, 네트워크 오류와 5xx 는 한도 안에서 다시 시도한다.
 * 4xx(키 오류 등)는 기다려도 바뀌지 않아 바로 포기한다.
 * 끝내 실패하면 경고만 남기고 .env 값으로 계속 간다(서버가 내려가도 봇은 뜬다).
 * @param options 재시도 한도·간격 덮어쓰기 (테스트용 — 기본은 env 상수)
 */
export async function loadRemoteSettings(
    options: { retryMaxMs?: number; retryIntervalMs?: number } = {},
): Promise<string[]> {
    if (!config.apiKey) return [];
    const retryMaxMs = options.retryMaxMs ?? REMOTE_SETTINGS_RETRY_MAX_MS;
    const retryIntervalMs = options.retryIntervalMs ?? REMOTE_SETTINGS_RETRY_INTERVAL_MS;
    const url = `${config.apiBaseUrl.replace(/\/$/, '')}/api/integrations/discord/runtime-config`;
    const startedAt = Date.now();
    for (let attempt = 1; ; attempt += 1) {
        let failure: string;
        try {
            const res = await fetch(url, {
                headers: { 'X-API-Key': config.apiKey },
                signal: AbortSignal.timeout(REMOTE_SETTINGS_TIMEOUT_MS),
            });
            if (res.ok) {
                const body = (await res.json()) as { data?: { settings?: Record<string, string> } };
                if (attempt > 1) {
                    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
                    console.log(`[discord-bot] 서버 설정 조회 성공 — ${attempt}번째 시도, ${elapsedSec}초 만에 받았습니다.`);
                }
                return applyRemoteSettings(body?.data?.settings ?? {});
            }
            if (res.status < 500) {
                console.warn(`[discord-bot] 서버 설정 조회 실패 (${res.status}) — .env 값으로 기동합니다.`);
                return [];
            }
            failure = `HTTP ${res.status}`;
        } catch (e) {
            failure = e instanceof Error ? e.message : String(e);
        }
        // 다음 시도가 한도를 넘기면 여기서 그만둔다 (retryMaxMs 0 = 재시도 없음)
        if (Date.now() - startedAt + retryIntervalMs > retryMaxMs) {
            console.warn(`[discord-bot] 서버 설정 조회 실패(${failure}) — .env 값으로 기동합니다.`);
            return [];
        }
        if (attempt === 1) {
            console.log(`[discord-bot] 서버 설정 조회 실패(${failure}) — 백엔드가 뜰 때까지 최대 ${Math.round(retryMaxMs / 1000)}초 동안 다시 시도합니다.`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
}

/** 서버 설정 조회 타임아웃 — 봇 기동을 오래 막지 않는다. */
const REMOTE_SETTINGS_TIMEOUT_MS = parseIntEnv(process.env.DISCORD_REMOTE_SETTINGS_TIMEOUT_MS, 5_000);

/** 서버 설정 조회 재시도 총 대기 한도 — 백엔드가 뜨는 시간(보통 수 초~수십 초)을 기다린다. 0 이면 재시도 없음. */
const REMOTE_SETTINGS_RETRY_MAX_MS = parseNonNegativeIntEnv(process.env.DISCORD_REMOTE_SETTINGS_RETRY_MAX_MS, 60_000);

/** 서버 설정 조회 재시도 간격 */
const REMOTE_SETTINGS_RETRY_INTERVAL_MS = parseIntEnv(process.env.DISCORD_REMOTE_SETTINGS_RETRY_INTERVAL_MS, 2_000);

/** Discord 메시지 하드 리밋(2000자) 아래 분할 여유치 */
export const DISCORD_CHUNK_LIMIT = 1900;

/** 설정 오류로 기동 불가 시 종료 코드 — PM2 stop_exit_codes 와 페어 (재시작 루프 방지) */
export const EXIT_CODE_CONFIG = 78; // EX_CONFIG

/** 필수 설정 검증. 문제 목록을 반환 (빈 배열 = OK) */
export function validateConfig(): string[] {
    const problems: string[] = [];
    if (!config.botToken) problems.push('DISCORD_BOT_TOKEN 이 설정되지 않았습니다 (관리자 화면 시스템 설정 또는 .env).');
    if (!config.apiKey) problems.push('DISCORD_BOT_API_KEY (omk_live_...) 가 설정되지 않았습니다.');
    if (!config.allowAllUsers && config.allowedUsers.length === 0 && config.allowedRoles.length === 0) {
        problems.push('접근 제어가 비어 있습니다 — DISCORD_ALLOWED_USERS / DISCORD_ALLOWED_ROLES 를 설정하거나 DISCORD_ALLOW_ALL_USERS=true 로 명시하세요.');
    }
    return problems;
}
