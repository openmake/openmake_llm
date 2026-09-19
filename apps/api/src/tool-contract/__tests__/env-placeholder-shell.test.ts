/** {{env.KEY}} 위치 인자 비밀 → sh 변수 참조 (2026-09-02 보안 리뷰 B5-01) */
import { wrapEnvPlaceholdersAsShellRefs } from '../env-placeholder-shell';
import { execFileSync } from 'child_process';

describe('wrapEnvPlaceholdersAsShellRefs', () => {
    it('자리표시자가 없으면 원본 그대로 (wrapped=false)', () => {
        const r = wrapEnvPlaceholdersAsShellRefs('npx', ['-y', 'pkg', '--flag']);
        expect(r).toEqual({ command: 'npx', args: ['-y', 'pkg', '--flag'], wrapped: false, keys: [] });
    });

    it('카탈로그 server-postgres 템플릿 — 값 대신 "$DATABASE_URL" 참조, 나머지는 positional', () => {
        const r = wrapEnvPlaceholdersAsShellRefs('npx', ['-y', '@modelcontextprotocol/server-postgres', '{{env.DATABASE_URL}}']);
        expect(r.wrapped).toBe(true);
        expect(r.keys).toEqual(['DATABASE_URL']);
        expect(r.command).toBe('sh');
        expect(r.args).toEqual(['-c', 'exec "$1" "$2" "$3" "$DATABASE_URL"', 'sh', 'npx', '-y', '@modelcontextprotocol/server-postgres']);
        // argv 어디에도 비밀 값이 들어갈 자리가 없다
        expect(r.args.join(' ')).not.toContain('postgres://');
    });

    it('리터럴과 자리표시자가 섞인 토큰은 작은따옴표 리터럴 + "$KEY" 로 이어 붙인다 (따옴표 이스케이프 포함)', () => {
        const r = wrapEnvPlaceholdersAsShellRefs('cmd', ["postgres://u:{{env.PW}}@h/db?o='x'", '{{env.A}}{{env.B}}']);
        expect(r.args[1]).toBe(`exec "$1" 'postgres://u:'"$PW"'@h/db?o='\\''x'\\''' "$A""$B"`);
        expect(r.keys).toEqual(['PW', 'A', 'B']);
    });

    it('실제 sh 로 전개하면 env 값이 인자에 정확히 들어간다 (argv 엔 참조만)', () => {
        const r = wrapEnvPlaceholdersAsShellRefs('printf', ['%s|%s|%s\\n', 'plain arg', "pre-{{env.SECRET}}-post'q", '{{env.SECRET}}']);
        const out = execFileSync(r.command, r.args, { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', SECRET: 's3cr3t value' }, encoding: 'utf8' });
        expect(out.trim()).toBe("plain arg|pre-s3cr3t value-post'q|s3cr3t value");
        expect(r.args.some((a) => a.includes('s3cr3t'))).toBe(false);
    });
});
