const warn = jest.fn();
jest.mock('../../utils/logger', () => ({ createLogger: () => ({ warn: (...a: unknown[]) => warn(...a), info: jest.fn(), debug: jest.fn(), error: jest.fn() }) }));

import { isControlEnvKey, stripControlEnv } from '../spawn-env-policy';

beforeEach(() => warn.mockClear());

describe('spawn-env-policy — 제어 env 키 거부 목록', () => {
    it.each([
        'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED',
        'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'PATH', 'PATHEXT',
        'npm_config_registry', 'NPM_CONFIG_REGISTRY', 'UV_THREADPOOL_SIZE', 'UV_INDEX_URL',
        'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONHOME', 'PIP_INDEX_URL', 'BASH_ENV', 'ENV', 'ZDOTDIR',
        'PERL5OPT', 'RUBYOPT', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'GCONV_PATH', 'IFS', 'DOCKER_HOST',
    ])('%s 는 제어 키다', (k) => expect(isControlEnvKey(k)).toBe(true));

    it.each(['HOME', 'FIRECRAWL_API_KEY', 'GH_HOST', 'NPM_TOKEN', 'DATABASE_URL', 'LANG'])('%s 는 허용', (k) =>
        expect(isControlEnvKey(k)).toBe(false));

    it.each(['GIT_SSH_COMMAND', 'GIT_CONFIG_PARAMETERS', 'GIT_EXEC_PATH', 'GIT_ASKPASS', 'HTTP_PROXY', 'https_proxy', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'GIT_SSL_NO_VERIFY'])(
        '제어 키 %s 는 거부', (k) => expect(isControlEnvKey(k)).toBe(true));

    it.each(['GITHUB_TOKEN', 'GIT_TOKEN', 'PROXY_HOST', 'HOME'])('%s 는 허용', (k) => expect(isControlEnvKey(k)).toBe(false));

    it('stripControlEnv 는 제어 키만 뺀 사본을 돌려주고 원본은 건드리지 않는다', () => {
        const src = { NODE_OPTIONS: '--require x', API_KEY: 'k', HOME: '/h' };
        expect(stripControlEnv(src)).toEqual({ API_KEY: 'k', HOME: '/h' });
        expect(src.NODE_OPTIONS).toBe('--require x');
        expect(stripControlEnv(undefined)).toBeUndefined();
        expect(stripControlEnv(null)).toBeUndefined();
    });

    // #1471 — git 동작을 바꾸는 제어 변수(설정 파일·저장소 위치·추적 출력)
    it.each(['GIT_CONFIG', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_TRACE', 'GIT_TRACE2', 'GIT_TRACE_SETUP', 'GIT_TRACE2_EVENT', 'GIT_TRACE_PACKET',
        'git_config', 'Git_Dir', 'git_work_tree', 'git_trace_setup'])('git 제어 키 %s 는 거부(대소문자 무시)', (k) => expect(isControlEnvKey(k)).toBe(true));

    it.each(['GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_PARAMETERS'])('기존 GIT_CONFIG_* 차단 %s 는 유지', (k) =>
        expect(isControlEnvKey(k)).toBe(true));

    it.each(['GIT_TOKEN', 'GIT_AUTHOR_NAME', 'GIT_COMMITTER_EMAIL', 'GITHUB_TOKEN', 'GIT_DIRECTORY_HINT', 'MY_GIT_DIR'])('git 자격증명·무관 이름 %s 는 허용', (k) =>
        expect(isControlEnvKey(k)).toBe(false));

    it('stripControlEnv 는 제거한 키 이름만 한 번 경고하고 값은 남기지 않는다', () => {
        const secret = 'tok-' + Math.random().toString(36).slice(2);
        const out = stripControlEnv({ GIT_DIR: `/tmp/${secret}`, GIT_TRACE: secret, GIT_TOKEN: secret, NODE_OPTIONS: `--require ${secret}` });
        expect(out).toEqual({ GIT_TOKEN: secret });
        expect(warn).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(warn.mock.calls);
        for (const k of ['GIT_DIR', 'GIT_TRACE', 'NODE_OPTIONS']) expect(logged).toContain(k);
        expect(logged).not.toContain(secret);
        expect(logged).not.toContain('GIT_TOKEN');
    });

    it('제거할 키가 없으면 경고하지 않는다', () => {
        stripControlEnv({ API_KEY: 'k', GIT_TOKEN: 't' });
        stripControlEnv(undefined);
        expect(warn).not.toHaveBeenCalled();
    });
});
