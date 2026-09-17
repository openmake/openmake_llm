/**
 * Discord gateway bot 설정 — 전부 환경변수에서 로드 (No-Hardcoding 정책 L1/L2).
 * 접근 제어 키 체계는 hermes-agent Discord gateway 와 동일한 의미론:
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
    requestTimeoutMs: parseIntEnv(process.env.DISCORD_BOT_REQUEST_TIMEOUT_MS, 120_000),

    // ── 접근 제어 (hermes-parity) ─────────────────────────────
    allowAllUsers: parseBool(process.env.DISCORD_ALLOW_ALL_USERS, false),
    allowedUsers: parseList(process.env.DISCORD_ALLOWED_USERS),
    allowedRoles: parseList(process.env.DISCORD_ALLOWED_ROLES),
    requireMention: parseBool(process.env.DISCORD_REQUIRE_MENTION, true),
    freeResponseChannels: parseList(process.env.DISCORD_FREE_RESPONSE_CHANNELS),

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
 * 실패는 조용히 무시하고 .env 값으로 계속 간다(서버가 내려가도 봇은 뜬다).
 */
export async function loadRemoteSettings(): Promise<string[]> {
    if (!config.apiKey) return [];
    const url = `${config.apiBaseUrl.replace(/\/$/, '')}/api/integrations/discord/runtime-config`;
    try {
        const res = await fetch(url, {
            headers: { 'X-API-Key': config.apiKey },
            signal: AbortSignal.timeout(REMOTE_SETTINGS_TIMEOUT_MS),
        });
        if (!res.ok) {
            console.warn(`[discord-bot] 서버 설정 조회 실패 (${res.status}) — .env 값으로 기동합니다.`);
            return [];
        }
        const body = (await res.json()) as { data?: { settings?: Record<string, string> } };
        return applyRemoteSettings(body?.data?.settings ?? {});
    } catch (e) {
        console.warn(`[discord-bot] 서버 설정 조회 실패(${e instanceof Error ? e.message : e}) — .env 값으로 기동합니다.`);
        return [];
    }
}

/** 서버 설정 조회 타임아웃 — 봇 기동을 오래 막지 않는다. */
const REMOTE_SETTINGS_TIMEOUT_MS = parseIntEnv(process.env.DISCORD_REMOTE_SETTINGS_TIMEOUT_MS, 5_000);

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
