/**
 * Agent Task E2E 픽스처 — CSRF(enforce) 서버에서도 동작하는 가입·로그인.
 *
 * gdpr-fixtures 의 signupUser 와 같은 방식(가입 → 로그인 → auth_token 쿠키)이지만,
 * 서버 기본값 CSRF_PROTECTION=enforce 에서는 쿠키 인증 POST/DELETE 에 Double-Submit
 * 토큰(csrf_token 쿠키 + X-CSRF-Token 헤더)이 필요하므로 먼저 /api/csrf-token 에서 받는다.
 * 사용자 정리는 gdpr-fixtures 의 deleteUser(id 지정)를 그대로 쓴다.
 */
import { request as pwRequest, type APIRequestContext } from '@playwright/test';

const TEST_PW = 'AgentTaskE2E!2026';

export interface AgentTaskUserFixture {
    userId: string;
    email: string;
    /** 모든 요청에 그대로 붙이는 헤더 — 인증 쿠키 + CSRF 쿠키·헤더 */
    headers: Record<string, string>;
}

/** CSRF 토큰 발급 — 응답 쿠키(csrf_token)는 ctx 에 저장되고 같은 값을 헤더로 돌려준다 */
export async function fetchCsrfToken(ctx: APIRequestContext): Promise<string> {
    const res = await ctx.get('/api/csrf-token');
    if (!res.ok()) throw new Error(`csrf-token failed: ${res.status()}`);
    const token = (await res.json())?.token;
    if (typeof token !== 'string' || !token) throw new Error('csrf-token response missing token');
    return token;
}

/** 게스트용 CSRF 헤더 — 인증 게이트(401)를 CSRF 거절(403)과 구분해 보려고 쓴다 */
export async function guestCsrfHeaders(baseURL: string | undefined): Promise<Record<string, string>> {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const token = await fetchCsrfToken(ctx);
        return { Cookie: `csrf_token=${token}`, 'X-CSRF-Token': token };
    } finally {
        await ctx.dispose();
    }
}

/** 신규 사용자 가입 + 로그인. 사용자마다 별도 request context 라 쿠키가 섞이지 않는다. */
export async function signupAgentTaskUser(baseURL: string | undefined): Promise<AgentTaskUserFixture> {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const csrf = await fetchCsrfToken(ctx);
        const ts = Date.now();
        const rand = Math.floor(Math.random() * 10000);
        const email = `e2e-agent-task-${ts}-${rand}@local.test`;
        const username = `e2e-agent-task-${ts}-${rand}`;
        const birth = new Date();
        birth.setFullYear(birth.getFullYear() - 30); // 성인(locale 무관)

        const reg = await ctx.post('/api/auth/register', {
            headers: { 'X-CSRF-Token': csrf },
            data: {
                username, email, password: TEST_PW,
                agreedToTerms: true,
                agreedToPrivacy: true,
                consentLocale: 'ko',
                birthDate: birth.toISOString().slice(0, 10),
            },
        });
        if (!reg.ok()) throw new Error(`register failed: ${reg.status()} ${await reg.text()}`);
        const regBody = await reg.json();
        const userId = String(regBody.data?.user?.id || regBody.data?.id || '');
        if (!userId) throw new Error('register response missing user.id');

        const login = await ctx.post('/api/auth/login', {
            headers: { 'X-CSRF-Token': csrf },
            data: { email, password: TEST_PW },
        });
        if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
        const authTokenMatch = /auth_token=([^;]+)/.exec(login.headers()['set-cookie'] || '');
        if (!authTokenMatch) throw new Error('login response missing auth_token cookie');

        return {
            userId,
            email,
            headers: { Cookie: `auth_token=${authTokenMatch[1]}; csrf_token=${csrf}`, 'X-CSRF-Token': csrf },
        };
    } finally {
        await ctx.dispose();
    }
}
