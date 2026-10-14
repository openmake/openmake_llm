/**
 * 도구 이름 교정(P0-b) — 순수 함수 테스트.
 *
 * 케이스는 운영 DB 에서 실제로 관측된 오류 형태를 그대로 옮겼다:
 * `web_url_read`(구 이름) · `Python REPL::repl_run_code`(구분자·대소문자) ·
 * `sh: 1: web_search: not found`(도구를 셸 명령으로 실행).
 */
import {
    normalizeToolName,
    suggestToolNames,
    withToolNameSuggestions,
    detectShellToolMisuse,
    formatShellToolMisuseHint,
} from '../tool-name-suggest';

const AVAILABLE = [
    'bash', 'file_ops', 'str_replace_editor', 'python_execute', 'plan_create', 'plan_update',
    'web_search', 'web_scrape', 'extract_webpage', 'generate_image', 'delegate',
    'python-repl::repl_run_code', 'mcp-kakao::search-web',
];

describe('normalizeToolName', () => {
    it('대소문자·구분자를 지운다', () => {
        expect(normalizeToolName('Python REPL::repl_run_code')).toBe('pythonreplreplruncode');
        expect(normalizeToolName('web-search')).toBe(normalizeToolName('web_search'));
    });
});

describe('suggestToolNames', () => {
    it('Claude Code 별칭을 이 환경 도구로 교정한다', () => {
        expect(suggestToolNames('Read', AVAILABLE)[0]).toBe('file_ops');
        expect(suggestToolNames('WebFetch', AVAILABLE)[0]).toBe('web_scrape');
        expect(suggestToolNames('Bash', AVAILABLE)[0]).toBe('bash');
    });

    it('구분자·대소문자만 다른 이름을 찾는다 (실측: Python REPL::repl_run_code)', () => {
        expect(suggestToolNames('Python REPL::repl_run_code', AVAILABLE)).toContain('python-repl::repl_run_code');
        expect(suggestToolNames('web-search', AVAILABLE)).toContain('web_search');
    });

    it('server::tool 의 도구 부분만 맞아도 후보로 낸다', () => {
        expect(suggestToolNames('kakao::search-web', AVAILABLE)).toContain('mcp-kakao::search-web');
    });

    it('오타를 편집거리로 교정한다', () => {
        expect(suggestToolNames('web_serch', AVAILABLE)).toContain('web_search');
    });

    it('무관한 이름에는 후보를 내지 않는다 (오탐 방지)', () => {
        expect(suggestToolNames('zzzzzzzzzzzz', AVAILABLE)).toEqual([]);
    });

    it('자기 자신은 후보에서 제외한다', () => {
        expect(suggestToolNames('bash', AVAILABLE)).not.toContain('bash');
    });

    it('빈 입력·빈 목록은 빈 배열', () => {
        expect(suggestToolNames('', AVAILABLE)).toEqual([]);
        expect(suggestToolNames('web_search', [])).toEqual([]);
    });

    it('maxSuggestions 상한을 지킨다', () => {
        expect(suggestToolNames('plan_creat', AVAILABLE, { maxSuggestions: 1 }).length).toBeLessThanOrEqual(1);
    });
});

describe('withToolNameSuggestions', () => {
    it('후보가 있으면 원문 뒤에 덧붙인다', () => {
        const msg = withToolNameSuggestions('도구를 찾을 수 없습니다: Read', 'Read', AVAILABLE);
        expect(msg).toContain('도구를 찾을 수 없습니다: Read');
        expect(msg).toContain('file_ops');
    });

    it('후보가 없으면 원문 그대로 (fail-open)', () => {
        const base = '도구를 찾을 수 없습니다: zzzzzzzzzzzz';
        expect(withToolNameSuggestions(base, 'zzzzzzzzzzzz', AVAILABLE)).toBe(base);
    });
});

describe('MCP 서버 이름을 도구로 부른 경우 (운영 2026-10-14 하루 13건)', () => {
    const WITH_SERVER = [
        ...AVAILABLE,
        'noapi-google-search::google_search', 'noapi-google-search::google_news', 'noapi-google-search::google_images',
        'noapi-google-search::google_maps',
    ];

    it('서버 이름만 부르면 그 서버의 서버::도구 들이 앞쪽 후보로 나온다', () => {
        const out = suggestToolNames('noapi-google-search', WITH_SERVER);
        expect(out).toEqual([
            'noapi-google-search::google_search', 'noapi-google-search::google_news', 'noapi-google-search::google_images',
        ]);
    });

    it('대소문자·구분자 차이는 기존 규칙처럼 무시한다', () => {
        expect(suggestToolNames('Noapi_Google_Search', WITH_SERVER)[0]).toBe('noapi-google-search::google_search');
    });

    it('안내 문구가 붙는다', () => {
        const msg = withToolNameSuggestions('도구를 찾을 수 없습니다: noapi-google-search', 'noapi-google-search', WITH_SERVER);
        expect(msg).toContain('도구를 찾을 수 없습니다: noapi-google-search');
        expect(msg).toContain('noapi-google-search::google_search');
        expect(msg).toContain('`noapi-google-search` 는 MCP 서버 이름입니다');
        expect(msg).toContain('`서버::도구`');
    });

    it('mcp_call 에 tool=서버 이름을 넘긴 형태(서버::서버)도 같은 안내를 받는다', () => {
        const name = 'noapi-google-search::noapi-google-search';
        expect(suggestToolNames(name, WITH_SERVER)[0]).toBe('noapi-google-search::google_search');
        expect(withToolNameSuggestions(`외부 도구를 찾을 수 없습니다: ${name}`, name, WITH_SERVER))
            .toContain('MCP 서버 이름입니다');
    });

    it(':: 가 있는 이름은 종전 규칙 그대로 (안내 없음)', () => {
        expect(suggestToolNames('kakao::search-web', WITH_SERVER)).toEqual(suggestToolNames('kakao::search-web', AVAILABLE));
        expect(withToolNameSuggestions('x', 'kakao::search-web', WITH_SERVER)).not.toContain('MCP 서버 이름입니다');
    });

    it('접두 일치가 없으면 종전과 동일', () => {
        for (const n of ['web_serch', 'Read', 'zzzzzzzzzzzz', 'plan_creat']) {
            expect(suggestToolNames(n, WITH_SERVER)).toEqual(suggestToolNames(n, AVAILABLE));
            expect(withToolNameSuggestions('x', n, WITH_SERVER)).not.toContain('MCP 서버 이름입니다');
        }
    });
});

describe('detectShellToolMisuse', () => {
    it('도구를 셸 명령으로 실행한 흔적을 찾는다 (실측 형태)', () => {
        const out = '[stderr]\nsh: 1: web_search: not found\n \n[exit=127 12ms]';
        expect(detectShellToolMisuse(out, AVAILABLE)).toEqual(['web_search']);
    });

    it('bash line 형식도 인식한다', () => {
        const out = 'bash: line 2: file_ops: command not found';
        expect(detectShellToolMisuse(out, AVAILABLE)).toEqual(['file_ops']);
    });

    it('도구가 아닌 명령은 무시한다', () => {
        expect(detectShellToolMisuse('sh: 1: jq: not found', AVAILABLE)).toEqual([]);
    });

    it('여러 번 나와도 중복 없이 모은다', () => {
        const out = 'sh: 1: web_search: not found\nsh: 2: web_search: not found\nsh: 3: web_scrape: not found';
        expect(detectShellToolMisuse(out, AVAILABLE)).toEqual(['web_search', 'web_scrape']);
    });

    it('빈 출력·빈 목록은 빈 배열', () => {
        expect(detectShellToolMisuse('', AVAILABLE)).toEqual([]);
        expect(detectShellToolMisuse('sh: 1: web_search: not found', [])).toEqual([]);
    });
});

describe('formatShellToolMisuseHint', () => {
    it('이름이 없으면 빈 문자열', () => {
        expect(formatShellToolMisuseHint([])).toBe('');
    });

    it('도구 호출로 부르라고 안내한다', () => {
        const hint = formatShellToolMisuseHint(['web_search']);
        expect(hint).toContain('web_search');
        expect(hint).toContain('tool_calls');
    });
});
