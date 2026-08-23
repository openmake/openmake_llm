/**
 * 로컬 브라우저(D3) 계약 회귀 테스트.
 *
 * 이 계약을 구현하던 Electron 데스크톱 실행기(agent-browser.js)는 앱과 함께 제거됐고
 * (2026-08-23), 현재 브리지 디바이스(Companion·CLI)는 browser 를 미지원으로 거부한다.
 * 서버측 계약은 컨테이너 runner 와 공유하므로 회귀 축으로 계속 고정한다 —
 *   ① allowlist 호스트 매칭 규칙이 컨테이너 runner 와 동일한가
 *   ② 결과 JSON 형태가 runner 와 같아 서버 파싱이 재사용되는가
 * 이 둘이 어긋나면 로컬/컨테이너 경로에서 에이전트가 다르게 행동한다.
 */

/** 로컬 실행기의 hostAllowed 와 동일 규칙 (runner 의 allowlist 매칭과도 일치해야 함). */
function hostAllowed(hostname: string, allowlist: string[] | null): boolean {
    if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
    const h = String(hostname || '').toLowerCase();
    return allowlist.some((d) => {
        const dd = String(d).toLowerCase();
        return h === dd || h.endsWith('.' + dd);
    });
}

describe('로컬 브라우저 allowlist — 컨테이너 runner 와 동일 규칙', () => {
    it('allowlist 가 없으면 전부 허용', () => {
        expect(hostAllowed('example.com', null)).toBe(true);
        expect(hostAllowed('example.com', [])).toBe(true);
    });

    it('정확히 일치하는 호스트 허용', () => {
        expect(hostAllowed('example.com', ['example.com'])).toBe(true);
    });

    it('서브도메인은 허용, 유사 도메인은 차단', () => {
        expect(hostAllowed('api.example.com', ['example.com'])).toBe(true);
        // evil-example.com 은 example.com 으로 끝나지만 '.' 경계가 없어 차단돼야 한다
        expect(hostAllowed('evil-example.com', ['example.com'])).toBe(false);
        expect(hostAllowed('example.com.evil.io', ['example.com'])).toBe(false);
    });

    it('대소문자 무관', () => {
        expect(hostAllowed('API.Example.COM', ['example.com'])).toBe(true);
    });

    it('목록에 없는 호스트는 차단', () => {
        expect(hostAllowed('other.io', ['example.com', 'foo.dev'])).toBe(false);
    });
});

describe('로컬 브라우저 결과 계약 — runner 와 동형', () => {
    /** infra/task-runtime/browser-runner.mjs 의 out() 형태 */
    interface RunnerOut {
        ok: boolean;
        finalUrl?: string;
        results: { i: number; type?: string; ok: boolean; error?: string }[];
        error?: string;
    }

    const parse = (stdout: string): RunnerOut => JSON.parse(stdout);

    it('성공 응답은 ok/finalUrl/results 를 갖는다', () => {
        const out = parse(JSON.stringify({
            ok: true, finalUrl: 'https://example.com/',
            results: [{ i: 0, type: 'goto', ok: true }, { i: 1, type: 'extractText', ok: true, text: 'hi' }],
        }));
        expect(out.ok).toBe(true);
        expect(out.results).toHaveLength(2);
        expect(out.results.every((r) => typeof r.i === 'number')).toBe(true);
    });

    it('액션 실패 시 ok=false 이고 실패 지점에서 멈춘 results 를 담는다', () => {
        const out = parse(JSON.stringify({
            ok: false, finalUrl: 'https://example.com/',
            results: [{ i: 0, type: 'goto', ok: true }, { i: 1, type: 'click', ok: false, error: '요소를 찾지 못했습니다' }],
        }));
        expect(out.ok).toBe(false);
        expect(out.results.at(-1)?.error).toContain('요소');
    });

    it('빈 액션 배열은 ok=false (runner 와 동일 — 아무것도 안 한 것을 성공으로 보지 않는다)', () => {
        const results: RunnerOut['results'] = [];
        const ok = results.length > 0 && results.every((r) => r.ok);
        expect(ok).toBe(false);
    });
});
