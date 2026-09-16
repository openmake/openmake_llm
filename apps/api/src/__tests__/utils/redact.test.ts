/**
 * redactText — 공유용 정화 규칙 + **회귀 코퍼스**.
 *
 * 코퍼스는 운영 `agent_task_steps` 에서 실제로 뽑은 문자열이다(2026-08-26). 규칙을 손볼 때
 * 이 케이스들이 계속 통과해야 한다 — 실제 데이터가 아닌 상상한 입력만으로는 누수를 못 잡는다.
 */
import { redactText, capText, redactSecrets } from '../../utils/redact';

describe('redactText — 경로', () => {
    test('홈 디렉토리를 ~ 로 접는다', () => {
        expect(redactText('/Users/openmake_mac/omk-worktree-test/.git/index.lock'))
            .toBe('~/omk-worktree-test/.git/index.lock');
        expect(redactText('/home/smith/vllm/vllm.env')).toBe('~/vllm/vllm.env');
    });

    test('worktree prefix 를 떼어 레포 상대경로로 만든다', () => {
        expect(redactText('.openmake/worktrees/a26e7d97-db3d-4232-bdd1-96c8186a14e6/src/a.ts'))
            .toBe('src/a.ts');
    });

    test('rootPath 이하를 상대경로로 만든다', () => {
        expect(redactText('/Volumes/MAC_APP/openmake_llm/apps/api/src/x.ts', { rootPath: '/Volumes/MAC_APP/openmake_llm' }))
            .toBe('apps/api/src/x.ts');
    });

    test('남은 시스템 절대경로는 <path>/ 로 접는다', () => {
        expect(redactText('open \'/private/tmp/openmake-task-workspaces/a00680d9/workspace/data.json\''))
            .toContain('<path>/data.json');
    });

    test('상대경로·URL 은 건드리지 않는다', () => {
        expect(redactText('src/a.ts 를 고쳤다')).toBe('src/a.ts 를 고쳤다');
        expect(redactText('https://raw.githubusercontent.com/nexu-io/open-design/main/QUICKSTART.md'))
            .toBe('https://raw.githubusercontent.com/nexu-io/open-design/main/QUICKSTART.md');
    });
});

describe('redactText — 자격증명', () => {
    test.each([
        ['omk_live_478eb1c2d3e4f5a6b7c8', '<redacted:api-key>'],
        ['sk-or-v1-11aabbccddeeff00112233', '<redacted:api-key>'],
        ['ghp_AbCdEfGhIjKlMnOpQrStUvWx01', '<redacted:token>'],
        ['AKIAIOSFODNN7EXAMPLE', '<redacted:aws-key>'],
    ])('%s → 마스킹', (secret, marker) => {
        expect(redactText(`key=${secret} 사용`)).toContain(marker);
        expect(redactText(`key=${secret} 사용`)).not.toContain(secret);
    });

    test('JWT 를 마스킹한다', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIzIn0.tLt3TNuxOOhpFVsZ8odcfL8Mqz';
        const out = redactText(`Authorization: Bearer ${jwt}`);
        expect(out).not.toContain('eyJ1c2VySWQ');
        expect(out).toMatch(/<redacted/);
    });

    test('env 대입은 키 이름을 남기고 값만 가린다 — 맥락 보존', () => {
        expect(redactText('LLM_API_KEY=sk-abcdef1234567890abcdef')).toBe('LLM_API_KEY=<redacted>');
        expect(redactText('DB_PASSWORD=hunter2trustno1')).toBe('DB_PASSWORD=<redacted>');
    });

    test('민감하지 않은 대입은 그대로 둔다', () => {
        expect(redactText('NODE_ENV=production')).toBe('NODE_ENV=production');
        expect(redactText('PORT=52416')).toBe('PORT=52416');
    });

    test('JSON 표기의 키/토큰 값도 가린다', () => {
        expect(redactText('{"apiKey": "abcdef123456789"}')).toBe('{"apiKey": "<redacted>"}');
    });

    test('이메일을 가린다', () => {
        expect(redactText('riskpw@openmake.cc 계정')).toBe('<email> 계정');
    });
});

describe('회귀 코퍼스 — 운영 agent_task_steps 실제 샘플 (2026-08-26)', () => {
    const CORPUS: { name: string; input: string; mustNotContain: string[] }[] = [
        {
            name: '샌드박스 workspace ENOENT',
            input: "Error: 편집 실패: ENOENT: no such file or directory, open '/private/tmp/openmake-task-workspaces/a00680d9-2459-4ed8-ac3d-55eb2e47cb18/workspace/data.json'",
            mustNotContain: ['/private/tmp/openmake-task-workspaces'],
        },
        {
            name: '사용자 홈의 git worktree 오류',
            input: 'Error: [stdout]\nls: /Users/openmake_mac/omk-worktree-test/.git/index.lock: No such file or directory',
            mustNotContain: ['/Users/openmake_mac'],
        },
        {
            name: 'git worktree 생성 실패(절대경로 2개)',
            input: "fatal: Unable to create '/Users/openmake_mac/omk-worktree-test/.git/worktrees/ae8fa97e/index.lock': Operation not permitted",
            mustNotContain: ['/Users/openmake_mac'],
        },
        {
            name: '서버 데이터 디렉토리 노출',
            input: '[{"type":"text","text":"Directory not found: /Volumes/MAC_APP/openmake_llm/data/users/11/workspace/lens"}]',
            mustNotContain: ['/Volumes/MAC_APP/openmake_llm/data/users'],
        },
        {
            name: '스크래치패드 경로 stdout',
            input: '[stdout]\n/private/tmp/claude-501/-Volumes-MAC-APP-openmake-llm/f9bf7beb/scratchpad/electron-workdir\n[exit=0 8ms]',
            mustNotContain: ['/private/tmp/claude-501'],
        },
    ];

    test.each(CORPUS)('$name — 민감 경로가 남지 않는다', ({ input, mustNotContain }) => {
        const out = redactText(input);
        for (const needle of mustNotContain) expect(out).not.toContain(needle);
    });

    test('정화 후에도 읽을 수 있는 정보는 남는다(과잉 삭제 방지)', () => {
        const out = redactText(CORPUS[1].input);
        expect(out).toContain('index.lock');       // 무엇이 문제였는지
        expect(out).toContain('No such file');     // 오류 종류
    });
});

describe('capText', () => {
    test('상한 이하는 그대로', () => expect(capText('abc', 10)).toBe('abc'));
    test('초과하면 자르고 원문 길이를 알린다', () => {
        const out = capText('x'.repeat(50), 10);
        expect(out.startsWith('xxxxxxxxxx…')).toBe(true);
        expect(out).toContain('50자 중 10자');
    });
    test('빈 문자열 안전', () => expect(capText('', 10)).toBe(''));
});

describe('redactSecrets — 로그 한 줄(F24.6)', () => {
    // 로그에 실제로 나오는 형태 — 값만 가리고 키·경로·URL·이메일·일반 식별자는 남아야 한다
    test.each([
        ['[ExternalMCP] headers {"x-api-key":"sk-or-v1-abcdef0123456789abcdef"}', '<redacted', 'abcdef0123456789abcdef'],
        ['Authorization: Bearer omk_live_478eb1c2d3e4f5a6b7c8d9', 'Bearer <redacted', '478eb1c2d3e4'],
        ['LITELLM_MASTER_KEY=sk-litellm-0123456789abcdefghij 로드', 'LITELLM_MASTER_KEY=<redacted>', '0123456789abcdefghij'],
        ['DATABASE_URL postgres://openmake:s3cr3t-pass@127.0.0.1:5432/openmake_llm', 'postgres://openmake:<redacted>@127.0.0.1:5432/openmake_llm', 's3cr3t-pass'],
        ['redis://default:hunter2hunter2@localhost:6379', 'redis://default:<redacted>@localhost:6379', 'hunter2hunter2'],
        ['token ghp_ABCDEFGHIJKLMNOPQRST1234 발급', '<redacted:token>', 'ghp_ABCDEFGHIJKLMNOPQRST'],
        ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIzIn0abc.c2lnbmF0dXJlc2lnbg', '<redacted:jwt>', 'eyJzdWIiOiIzIn0'],
        ['x-api-key: hasa-abcdefghijklmnop', 'x-api-key: <redacted>', 'abcdefghijklmnop'],
    ])('%s', (input, mustContain, mustNotContain) => {
        const out = redactSecrets(input);
        expect(out).toContain(mustContain);
        expect(out).not.toContain(mustNotContain);
    });

    test('경로·URL·이메일·일반 식별자는 그대로 둔다(운영 디버깅 정보)', () => {
        const lines = [
            '[AgentTask] 워크스페이스 /private/tmp/openmake-task-workspaces/a00680d9/workspace 생성',
            '[Chat] 모델 qwen3.8-27b → https://mcp.linear.app/mcp 연결 (user 3, session 6f1c2a9e-1b2c-4d3e-8f90-abcdef123456)',
            '[Auth] 로그인 excellokrea2@example.com 성공',
            'postgres://127.0.0.1:5432/openmake_llm 연결',
            'task-queue 대기 3 · risk-assessment 완료',
        ];
        for (const l of lines) expect(redactSecrets(l)).toBe(l);
    });

    test('redactText 는 종전처럼 경로·이메일까지 접는다(공유용 계약 불변)', () => {
        expect(redactText('Bearer abcdefghijklmnop /Users/me/x/y/z.txt a@b.co'))
            .toBe('Bearer <redacted> ~/x/y/z.txt <email>');
    });
});
