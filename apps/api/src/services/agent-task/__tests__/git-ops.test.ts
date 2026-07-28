/** git-ops parseGithubRepo 유닛테스트 — repo URL 파싱·거절 규칙. */
import { parseGithubRepo } from '../git-ops';

describe('parseGithubRepo', () => {
    it('표준 https github URL 파싱', () => {
        expect(parseGithubRepo('https://github.com/openmake/openmake_llm')).toEqual({
            owner: 'openmake', repo: 'openmake_llm', cleanUrl: 'https://github.com/openmake/openmake_llm',
        });
    });
    it('.git 접미·트레일링 슬래시 허용', () => {
        expect(parseGithubRepo('https://github.com/a/b.git')?.repo).toBe('b');
        expect(parseGithubRepo('https://github.com/a/b/')?.repo).toBe('b');
    });
    it('cleanUrl 은 토큰·접미 제거된 정규형', () => {
        expect(parseGithubRepo('https://github.com/a/b.git')?.cleanUrl).toBe('https://github.com/a/b');
    });
    it('ssh·타 호스트·http 는 거절', () => {
        expect(parseGithubRepo('git@github.com:a/b.git')).toBeNull();
        expect(parseGithubRepo('https://gitlab.com/a/b')).toBeNull();
        expect(parseGithubRepo('http://github.com/a/b')).toBeNull();
        expect(parseGithubRepo('https://github.com/a')).toBeNull(); // repo 누락
    });
    it('경로 주입 시도 거절(../, 공백)', () => {
        expect(parseGithubRepo('https://github.com/a/../etc')).toBeNull();
        expect(parseGithubRepo('https://github.com/a/b c')).toBeNull();
    });
});

describe('maybePushAndOpenPR (가드)', () => {
    it('runtime/repo 없으면 no-op(예외 없음)', async () => {
        const { maybePushAndOpenPR } = await import('../git-ops');
        await expect(maybePushAndOpenPR(null, {}, 'u', 't', 'goal')).resolves.toBeUndefined();
        await expect(maybePushAndOpenPR({ workspacePath: '/tmp/x' }, {}, 'u', 't', 'goal')).resolves.toBeUndefined();
    });
});
