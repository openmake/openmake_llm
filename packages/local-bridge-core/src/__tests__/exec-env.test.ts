import { buildExecEnv } from '../exec-env';

describe('buildExecEnv — exec 자식 환경 allowlist', () => {
    const source = {
        HOME: '/Users/me', USER: 'me', SHELL: '/bin/zsh', TERM: 'xterm', LANG: 'ko_KR.UTF-8', LC_ALL: 'C', TMPDIR: '/tmp/x', TZ: 'Asia/Seoul',
        PATH: '/old', OMK_COMPANION_API_KEY: 'omk_live_secret', AWS_SECRET_ACCESS_KEY: 's', GITHUB_TOKEN: 't', OMK_BRIDGE_AUTO_APPROVE: '1',
    } as NodeJS.ProcessEnv;

    it('posix: 기본 키만 복사하고 PATH 는 인자 값으로 둔다', () => {
        const env = buildExecEnv(source, '/resolved/bin', 'darwin');
        expect(env).toEqual({ HOME: '/Users/me', USER: 'me', SHELL: '/bin/zsh', TERM: 'xterm', LANG: 'ko_KR.UTF-8', LC_ALL: 'C', TMPDIR: '/tmp/x', TZ: 'Asia/Seoul', PATH: '/resolved/bin' });
    });

    it('비밀·브리지 제어 키는 어떤 플랫폼에서도 넘어가지 않는다', () => {
        for (const p of ['darwin', 'linux', 'win32'] as const) {
            const env = buildExecEnv(source, '/p', p);
            expect(Object.keys(env)).not.toEqual(expect.arrayContaining(['OMK_COMPANION_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'OMK_BRIDGE_AUTO_APPROVE']));
        }
    });

    it('win32: cmd.exe 기동에 필요한 시스템 키를 대소문자 무시로 복사한다', () => {
        const env = buildExecEnv({ SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\system32\\cmd.exe', USERPROFILE: 'C:\\Users\\me', TEMP: 'C:\\t', PATHEXT: '.EXE', Path: 'C:\\old', SECRET: 'x' } as NodeJS.ProcessEnv, 'C:\\resolved', 'win32');
        expect(env).toEqual({ SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\system32\\cmd.exe', USERPROFILE: 'C:\\Users\\me', TEMP: 'C:\\t', PATHEXT: '.EXE', PATH: 'C:\\resolved' });
    });
});
