/**
 * e2e 공통 계정 helper — CSRF(enforce) 서버에서도 동작하는 가입·로그인.
 *
 * 서버 기본값 CSRF_PROTECTION=enforce 에서는 쿠키 인증 POST/DELETE 에 Double-Submit
 * 토큰(csrf_token 쿠키 + X-CSRF-Token 헤더)이 필요하므로 먼저 /api/csrf-token 에서 받는다.
 * agent-task-fixtures 와 plugin-boundary-fixtures 가 함께 쓴다. 사용자 정리는
 * gdpr-fixtures 의 deleteUser(id 지정)를 쓴다.
 */
import { request as pwRequest, type APIRequestContext } from '@playwright/test';

export interface E2eAccount {
    userId: string;
    email: string;
    /** 로그인 응답의 auth_token 쿠키 값 — WS 연결처럼 헤더를 직접 만드는 곳에서 쓴다 */
    authToken: string;
    /** 모든 요청에 그대로 붙이는 헤더 — 인증 쿠키 + CSRF 쿠키·헤더 */
    headers: Record<string, string>;
}

export interface E2eAccountOptions {
    /** 이메일·사용자명 앞부분 — 뒤에 시각·난수가 붙는다 */
    prefix: string;
    password: string;
    /** 가입 직후·로그인 전에 할 일(예: 관리자 승격) — 로그인 토큰에 바뀐 역할이 실리게 한다 */
    afterRegister?: (userId: string) => Promise<void>;
}

/** CSRF 토큰 발급 — 응답 쿠키(csrf_token)는 ctx 에 저장되고 같은 값을 헤더로 돌려준다 */
export async function fetchCsrfToken(ctx: APIRequestContext): Promise<string> {
    const res = await ctx.get('/api/csrf-token');
    if (!res.ok()) throw new Error(`csrf-token failed: ${res.status()}`);
    const token = (await res.json())?.token;
    if (typeof token !== 'string' || !token) throw new Error('csrf-token response missing token');
    return token;
}

/** 신규 사용자 가입 + 로그인. 사용자마다 별도 request context 라 쿠키가 섞이지 않는다. */
export async function signupE2eAccount(baseURL: string | undefined, opts: E2eAccountOptions): Promise<E2eAccount> {
    const ctx = await pwRequest.newContext({ baseURL });
    try {
        const csrf = await fetchCsrfToken(ctx);
        const ts = Date.now();
        const rand = Math.floor(Math.random() * 10000);
        const email = `${opts.prefix}-${ts}-${rand}@local.test`;
        const username = `${opts.prefix}-${ts}-${rand}`;
        const birth = new Date();
        birth.setFullYear(birth.getFullYear() - 30); // 성인(locale 무관)

        const reg = await ctx.post('/api/auth/register', {
            headers: { 'X-CSRF-Token': csrf },
            data: {
                username, email, password: opts.password,
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

        if (opts.afterRegister) await opts.afterRegister(userId);

        const login = await ctx.post('/api/auth/login', {
            headers: { 'X-CSRF-Token': csrf },
            data: { email, password: opts.password },
        });
        if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
        const authTokenMatch = /auth_token=([^;]+)/.exec(login.headers()['set-cookie'] || '');
        if (!authTokenMatch) throw new Error('login response missing auth_token cookie');

        return {
            userId,
            email,
            authToken: authTokenMatch[1],
            headers: { Cookie: `auth_token=${authTokenMatch[1]}; csrf_token=${csrf}`, 'X-CSRF-Token': csrf },
        };
    } finally {
        await ctx.dispose();
    }
}
