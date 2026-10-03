/**
 * 승인 저장본의 키 이름 판정 — 낱말 경계로 보고 비밀을 뜻하는 낱말일 때만 가린다.
 * 조각 일치(key·auth·session·token 이 들어가기만 하면 가림)는 승인 카드에서 `keywords`·`max_tokens`·
 * 브라우저 `key: "Enter"` 를 가려 사용자가 승인할 내용을 못 봤다. 공용 마스킹(스텝 기록)은 종전 그대로다.
 */
import { redactApprovalArgs, isSecretArgKey } from '../approval-redact';
import { maskSensitiveKeys } from '../../agent-task/tool-args';

const R = '[REDACTED]';

describe('승인 저장본 — 비밀이 아닌 키는 남긴다', () => {
    it('keywords·max_tokens·token_count·브라우저 key 는 보인다', () => {
        const args = { keywords: ['날씨', '서울'], max_tokens: 4096, token_count: 120, action: 'press', key: 'Enter' };
        expect(redactApprovalArgs('web_search', args)).toEqual(args);
    });

    it.each([
        ['key', 'Enter'], ['key', 'a'], ['key', 'Control+Shift+P'], ['key', 'ArrowDown'], ['key', 'F5'], ['keys', 'Meta+A'],
        ['keyword', 'x'], ['keywords', 'a b'], ['max_tokens', 100], ['maxTokens', 100], ['token_count', 3], ['tokenCount', 3],
        ['prompt_tokens', 10], ['token_type', 'word'], ['next_page_token', 'CAESBQ'], ['sort_key', 'created_at'], ['sortKey', 'name'],
        ['primary_key', 'id'], ['cache_key', 'home:v1'], ['idempotency_key', 'run-2026-10-04'], ['author', 'kim'], ['authors', ['a']],
        ['session_name', '주간 회의'], ['session_timeout', 30], ['user_id', 'u1'], ['task_id', 't1'], ['monkey', 'x'], ['tokenizer', 'bpe'],
    ])('%s: %j 는 가리지 않는다', (key, value) => {
        expect(redactApprovalArgs('srv::tool', { [key]: value })).toEqual({ [key]: value });
    });

    it('중첩 안에서도 같은 판정이다', () => {
        const args = { options: { max_tokens: 10, keywords: ['a'] }, steps: [{ action: 'press', key: 'Tab' }] };
        expect(redactApprovalArgs('browser', args)).toEqual(args);
    });
});

describe('승인 저장본 — 비밀 키는 계속 가린다', () => {
    it.each([
        'password', 'passwd', 'pwd', 'db_password', 'userPassword', 'secret', 'client_secret', 'clientSecret', 'clientsecret', 'SECRET_KEY',
        'api_key', 'apiKey', 'apikey', 'API_KEY', 'OPENAI_API_KEY', 'x-api-key', 'private_key', 'privateKey', 'access_key', 'signing_key',
        'openai_key', 'authorization', 'Authorization', 'proxy-authorization', 'auth', 'X-Auth-Token', 'auth_token', 'authToken',
        'access_token', 'accessToken', 'accesstoken', 'refresh_token', 'id_token', 'token', 'api_token', 'bot_token', 'tokens',
        'cookie', 'Cookie', 'cookies', 'set-cookie', 'session', 'session_id', 'sessionId', 'sessionid', 'session_token', 'credential', 'credentials',
    ])('%s 의 값을 가린다', (key) => {
        expect(isSecretArgKey(key, 'hunter2hunter2')).toBe(true);
        expect(redactApprovalArgs('srv::tool', { [key]: 'hunter2hunter2' })).toEqual({ [key]: R });
    });

    it('key 의 값이 키보드 키 이름이 아니면 가린다', () => {
        expect(redactApprovalArgs('srv::tool', { key: 'hunter2' })).toEqual({ key: R });
        expect(redactApprovalArgs('srv::tool', { key: 'Zx9Enter' })).toEqual({ key: R });
        expect(redactApprovalArgs('srv::tool', { key: { value: 'abc' } })).toEqual({ key: R });
    });

    it('수량 낱말이 붙지 않은 token 은 값이 문자열이면 가리고, 숫자면 남긴다', () => {
        expect(redactApprovalArgs('srv::tool', { tokens: ['tok-1'] })).toEqual({ tokens: R });
        expect(redactApprovalArgs('srv::tool', { tokens: 12 })).toEqual({ tokens: 12 });
    });

    it('남긴 키의 값에 섞인 자격증명은 값 패턴으로 가린다', () => {
        const sk = 'sk-abcdef0123456789abcdef0123';
        const out = redactApprovalArgs('srv::tool', { keywords: [`find ${sk}`], sort_key: `Bearer ${sk}`, key: sk });
        expect(JSON.stringify(out)).not.toContain(sk);
    });
});

describe('공용 마스킹(스텝 기록)은 종전 기준 그대로', () => {
    it('키 이름 조각 일치로 가린다', () => {
        expect(maskSensitiveKeys({ keywords: ['a'], max_tokens: 10, key: 'Enter', page: 1 })).toEqual({ keywords: R, max_tokens: R, key: R, page: 1 });
    });
});
