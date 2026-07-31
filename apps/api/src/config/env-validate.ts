/**
 * ============================================================
 * Environment Config Validation — env.ts 에서 분리 (파일 크기 가드)
 * ============================================================
 * 필수 환경 변수 검증. 런타임 시작 전에 호출하여 설정 오류를 조기에 발견.
 *
 * @module config/env-validate
 */
import type { EnvConfig } from './env';

export function validateConfig(config: EnvConfig): void {
    const errors: string[] = [];

    // URL 검증
    if (!config.llmBaseUrl || !config.llmBaseUrl.startsWith('http')) {
        errors.push(`Invalid LLM_BASE_URL: ${config.llmBaseUrl}`);
    }

    // 모델 이름 검증
    if (!config.llmDefaultModel || config.llmDefaultModel.trim() === '') {
        errors.push('LLM_DEFAULT_MODEL is required');
    }

    // 타임아웃 검증
    if (config.llmTimeout <= 0 || config.llmTimeout > 600000) {
        errors.push(`Invalid LLM_TIMEOUT: ${config.llmTimeout} (must be between 1-600000ms)`);
    }

    // JWT_SECRET 필수 검증 (test 환경 제외 — 랜덤 생성 금지: PM2 재시작마다 세션 무효화)
    if (config.nodeEnv !== 'test' && (!config.jwtSecret || config.jwtSecret.length < 32)) {
        errors.push('JWT_SECRET must be at least 32 characters (set in .env). Random generation is forbidden — it invalidates all sessions on restart.');
    }

    // Production에서 HTTPS 없이 쿠키 전송 방지 — HttpOnly 쿠키가 평문으로 노출되는 것을 차단.
    // HTTPS 미지원 환경에서는 ALLOW_INSECURE_COOKIES=true 로 명시적 opt-out 가능.
    if (config.nodeEnv === 'production' && !config.cookieSecure) {
        if (!config.allowInsecureCookies) {
            errors.push(
                'COOKIE_SECURE must be true in production. ' +
                'Set COOKIE_SECURE=true in .env when running behind HTTPS, ' +
                'or set ALLOW_INSECURE_COOKIES=true to explicitly opt out (insecure — tokens transmitted in plaintext).'
            );
        } else {
            // Logger가 아직 초기화되지 않았으므로 console.warn 사용
            console.warn(
                '\n\x1b[33m[SECURITY WARNING]\x1b[0m COOKIE_SECURE=false in production with ALLOW_INSECURE_COOKIES=true.\n' +
                '  HttpOnly session cookies (JWT access/refresh tokens) will be transmitted over plaintext HTTP.\n' +
                '  This is vulnerable to MITM token theft. Deploy HTTPS (e.g. Caddy, Cloudflare Tunnel) as soon as possible.\n'
            );
        }
    }

    // API_KEY_PEPPER 검증 (프로덕션 환경에서 API Key 서비스 사용 시)
    if (config.nodeEnv === 'production' && config.apiKeyPepper === '') {
        errors.push('API_KEY_PEPPER is required in production for API key hashing security');
    }

    // CORS: 전역 credentials=true 환경이므로 와일드카드('*') Origin 은 CORS 스펙상 금지.
    // 운영 환경에서 CORS_ORIGINS 에 '*' 가 있으면 부팅 중단 (명시적 allowlist 강제).
    if (config.nodeEnv === 'production' &&
        config.corsOrigins.split(',').map((o) => o.trim()).includes('*')) {
        errors.push(
            'CORS_ORIGINS must not contain a wildcard (*) in production. ' +
            'credentials 기반 인증 환경에서는 명시적 Origin allowlist 가 필요합니다.'
        );
    }

    // Stage 2-H3: STORAGE_BACKEND=redis 선택 시 REDIS_URL 필수
    if (config.storageBackend === 'redis' && !config.redisUrl) {
        errors.push('REDIS_URL must be set when STORAGE_BACKEND=redis');
    }

    // LLM_API_KEY 가 dummy 'sk-no-key' 인데 production 운영 — LiteLLM master_key 설정 시 401 폭발.
    // 운영자가 LiteLLM 을 비인증 모드로 의도했으면 무시 가능 — 경고로만 출력 (errors push 안 함).
    if (config.nodeEnv === 'production' && (config.llmApiKey === '' || config.llmApiKey === 'sk-no-key')) {
        console.warn(
            '\n\x1b[33m[CONFIG WARN]\x1b[0m LLM_API_KEY is unset or default placeholder (\'sk-no-key\') in production.\n' +
            '  If LiteLLM master_key or vLLM --api-key is enabled upstream, all requests will be rejected with 401.\n' +
            '  Set LLM_API_KEY to the actual proxy key in .env, or keep this placeholder only if auth is disabled.\n'
        );
    }

    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}
