/**
 * 로거 출력 마스킹(F24.6) — 파일 포맷(메시지·meta JSON)과 콘솔 포맷 모두에서 자격증명 값이 사라진다.
 * winston 포맷을 직접 transform 해 출력 문자열을 검사한다(파일 transport 없이).
 */
import { customFormat, consoleLine, redactForLog } from '../logger';

const MESSAGE = Symbol.for('message');
function render(format: typeof customFormat, info: Record<string, unknown>): string {
    const out = format.transform({ level: 'info', ...info } as never, {}) as Record<string | symbol, unknown>;
    return String(out[MESSAGE]);
}

describe('logger redaction', () => {
    test('파일 포맷 — 메시지와 meta(스택 포함) 모두 마스킹', () => {
        const line = render(customFormat, { message: '[Gateway] 요청 Authorization: Bearer abcdefghijklmnopqrst', meta: { url: 'postgres://u:topsecret-value@h:5432/db' } });
        expect(line).toContain('Bearer <redacted>');
        expect(line).not.toContain('abcdefghijklmnopqrst');
        expect(line).toContain('postgres://u:<redacted>@h:5432/db');
    });

    test('콘솔 포맷(pm2 로그)도 마스킹', () => {
        const line = consoleLine({ level: 'info', timestamp: '10:00:00', message: 'OPENROUTER_API_KEY=sk-or-v1-0123456789abcdef0123' });
        expect(line).toContain('OPENROUTER_API_KEY=<redacted>');
        expect(line).not.toContain('0123456789abcdef0123');
    });

    test('짧은 문자열은 검사하지 않고 그대로', () => {
        expect(redactForLog('ok')).toBe('ok');
    });

    test('1만 줄 처리 성능 — 과도한 지연이 없다', () => {
        const sample = '[ChatTiming] session=6f1c2a9e ttft=1234ms tools=12 model=qwen3.8-27b path=/private/tmp/x/y/z';
        const t0 = Date.now();
        for (let i = 0; i < 10_000; i++) redactForLog(sample);
        expect(Date.now() - t0).toBeLessThan(1000);
    });
});
