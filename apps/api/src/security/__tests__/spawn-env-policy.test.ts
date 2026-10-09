import { isControlEnvKey, stripControlEnv } from '../spawn-env-policy';

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

    it('stripControlEnv 는 제어 키만 뺀 사본을 돌려주고 원본은 건드리지 않는다', () => {
        const src = { NODE_OPTIONS: '--require x', API_KEY: 'k', HOME: '/h' };
        expect(stripControlEnv(src)).toEqual({ API_KEY: 'k', HOME: '/h' });
        expect(src.NODE_OPTIONS).toBe('--require x');
        expect(stripControlEnv(undefined)).toBeUndefined();
        expect(stripControlEnv(null)).toBeUndefined();
    });
});
