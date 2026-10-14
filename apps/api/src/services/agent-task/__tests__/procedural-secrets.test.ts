/**
 * 절차 스킬 저장 전 평문 비밀 값 검사(findPlaintextSecrets) — 기본 규칙(config/procedural-skill 의 env 미설정 기본값)을 그대로 검증한다.
 * 브라우저: text|value 가 {{param}} 이 아니고, selector·label·name·placeholder 중 하나가 비밀 입력란 이름이면 걸린다.
 * 스크립트: code 본문에 bearer·sk-·omk_live_·"키이름=리터럴(6자+)" 모양이 있으면 걸린다.
 */
import { findPlaintextSecrets } from '../procedural-secrets';

const browser = (...actions: unknown[]) => findPlaintextSecrets({ kind: 'browser', actions });
const script = (code: string | undefined) => findPlaintextSecrets({ kind: 'script', lang: 'bash', code });

describe('findPlaintextSecrets — 브라우저 입력값', () => {
    it.each([
        ['selector 의 password', { type: 'fill', selector: 'input[type=password]', text: 'hunter2!' }],
        ['selector 의 passwd', { type: 'fill', selector: '#passwd', text: 'hunter2!' }],
        ['selector 의 pwd(단어 경계)', { type: 'fill', selector: 'input[name=pwd]', text: 'hunter2!' }],
        ['label 의 비밀번호', { type: 'smartFill', label: '비밀번호', text: 'hunter2!' }],
        ['name 의 API Key', { type: 'smartFill', role: 'textbox', name: 'API Key', text: 'abcd1234' }],
        ['name 의 api_key', { type: 'smartFill', name: 'api_key', text: 'abcd1234' }],
        ['placeholder 의 인증번호', { type: 'fill', selector: '#c', placeholder: '인증번호 6자리', text: '123456' }],
        ['selector 의 otp', { type: 'fill', selector: 'input#otp', text: '123456' }],
        ['selector 의 token(대소문자 무시)', { type: 'fill', selector: '#AccessToken', text: 'xyz' }],
        ['label 의 Secret', { type: 'smartFill', label: 'Client Secret', text: 'xyz' }],
        ['label 의 credential', { type: 'smartFill', label: 'Credentials', text: 'xyz' }],
        ['label 의 보안코드', { type: 'smartFill', label: '보안코드', text: '987' }],
        ['label 의 암호', { type: 'smartFill', label: '암호', text: 'x' }],
    ])('%s 에 넣은 평문을 찾는다', (_n, action) => {
        expect(browser(action)).toHaveLength(1);
    });

    it('text 대신 value 필드에 넣은 값도 본다', () => {
        expect(browser({ type: 'fill', selector: '#password', value: 'hunter2!' })).toHaveLength(1);
    });

    it('text 가 빈 문자열이면 value 를 본다', () => {
        expect(browser({ type: 'fill', selector: '#password', text: '', value: 'hunter2!' })).toHaveLength(1);
    });

    it('결과에는 위치·액션 종류·입력란만 싣고 값 자체는 싣지 않는다', () => {
        const hits = browser(
            { type: 'goto', url: 'https://example.com/login' },
            { type: 'fill', selector: 'input[name=email]', text: 'a@example.com' },
            { type: 'fill', selector: ' input[type=password] ', text: 'hunter2!' },
        );
        expect(hits).toEqual(['actions[2] (fill → input[type=password])']);
        expect(hits.join('')).not.toContain('hunter2!');
    });

    it('type 이 없으면 action 으로 적는다', () => {
        expect(browser({ selector: '#password', text: 'pw123456' })).toEqual(['actions[0] (action → #password)']);
    });

    it('여러 입력란 이름을 합쳐 보여 주고, 여러 건이면 모두 순서대로 낸다', () => {
        const hits = browser(
            { type: 'smartFill', label: '비밀번호', name: 'pw', text: 'a1' },
            { type: 'fill', selector: '#q', text: 'search' },
            { type: 'fill', selector: '#otp', text: '000111' },
        );
        expect(hits).toEqual(['actions[0] (smartFill → 비밀번호 pw)', 'actions[2] (fill → #otp)']);
    });

    it('짧은 값도 비밀 입력란이면 걸린다(길이 하한 없음 — 보수적)', () => {
        expect(browser({ type: 'fill', selector: '#password', text: '1' })).toHaveLength(1);
    });

    it('마스킹된 값(****)도 리터럴이라 걸린다 — {{param}} 만 통과한다(현재 규칙)', () => {
        expect(browser({ type: 'fill', selector: '#password', text: '********' })).toHaveLength(1);
    });

    it.each(['{{password}}', '{{ pw }}', '  {{user.pass-word}}  '])('{{param}} 하나로만 된 값 %p 은 통과', (text) => {
        expect(browser({ type: 'fill', selector: '#password', text })).toEqual([]);
    });

    it('{{param}} 에 리터럴이 덧붙으면 평문으로 본다', () => {
        expect(browser({ type: 'fill', selector: '#password', text: '{{pw}}123' })).toHaveLength(1);
        expect(browser({ type: 'fill', selector: '#password', text: '{{a}}{{b}}' })).toHaveLength(1);
    });

    it('비밀 입력란이 아니면 걸리지 않는다', () => {
        expect(browser(
            { type: 'fill', selector: 'input[name=email]', text: 'a@example.com' },
            { type: 'smartFill', label: '검색어', text: 'password reset 방법' },
            { type: 'fill', selector: '#stopwd', text: 'x' }, // \bpwd\b — 단어 중간의 pwd 는 아니다
        )).toEqual([]);
    });

    it('값이 없는 액션(click·press·waitFor)은 입력란 이름이 비밀이어도 걸리지 않는다', () => {
        expect(browser(
            { type: 'click', selector: '#password' },
            { type: 'press', key: 'Enter' },
            { type: 'waitFor', selector: 'input[type=password]' },
        )).toEqual([]);
    });

    it('문자열이 아닌 값·입력란 필드는 무시한다', () => {
        expect(browser({ type: 'fill', selector: '#password', text: 12345678 })).toEqual([]);
        expect(browser({ type: 'fill', selector: { css: '#password' }, text: 'hunter2!' })).toEqual([]);
    });

    it('객체가 아닌 액션(null·문자열·숫자)은 건너뛰고 인덱스는 원래 위치를 쓴다', () => {
        expect(browser(null, 'fill', 3, { type: 'fill', selector: '#password', text: 'pw' })).toEqual(['actions[3] (fill → #password)']);
    });

    it('빈 입력 — actions 가 없거나 빈 배열이면 빈 목록', () => {
        expect(findPlaintextSecrets({ kind: 'browser' })).toEqual([]);
        expect(browser()).toEqual([]);
    });

    it('브라우저 절차는 code 를 보지 않는다', () => {
        expect(findPlaintextSecrets({ kind: 'browser', actions: [], code: 'TOKEN=sk-abcdefghijklmnop1234' })).toEqual([]);
    });

    // 결함: goto 의 url 은 검사하지 않는다 — 주소에 박힌 자격 증명·토큰이 그대로 저장된다.
    // 재현: findPlaintextSecrets({ kind:'browser', actions:[{ type:'goto', url:'https://admin:hunter2@example.com/?access_token=abcdef123456' }] }) → []
    it.skip('[결함] goto url 에 박힌 자격 증명·토큰을 찾는다', () => {
        expect(browser({ type: 'goto', url: 'https://admin:hunter2@example.com/' })).toHaveLength(1);
        expect(browser({ type: 'goto', url: 'https://example.com/cb?access_token=abcdef123456' })).toHaveLength(1);
    });

    // 결함: dialog{promptText} 는 text|value 가 아니라 검사 밖이다 — 비밀번호를 묻는 prompt 창에 넣은 평문이 저장된다.
    // 재현: findPlaintextSecrets({ kind:'browser', actions:[{ type:'dialog', accept:true, promptText:'hunter2!', label:'비밀번호' }] }) → []
    it.skip('[결함] 확인창 promptText 의 평문을 찾는다', () => {
        expect(browser({ type: 'dialog', accept: true, promptText: 'hunter2!', label: '비밀번호' })).toHaveLength(1);
    });
});

describe('findPlaintextSecrets — 스크립트 본문', () => {
    it.each([
        ['Bearer 토큰', 'curl -H "Authorization: Bearer abcdefghijklmnop1234" https://api.example.com'],
        ['bearer 소문자', 'auth="bearer abcdefghij.klmnop-1234"'],
        ['OpenAI 형식 sk- 키', 'export OPENAI_VALUE=sk-proj_abcdefghijklmnop'],
        ['omk_live_ 키', 'KEY_VALUE=omk_live_abcd1234'],
        ['password=리터럴', 'mysql --password=hunter22 db'],
        ['PGPASSWORD=리터럴', 'PGPASSWORD=supersecret psql'],
        ['token: 리터럴(YAML)', 'token: abcdef123'],
        ['"api_key": "리터럴"(JSON)', '{"api_key": "abcdef123"}'],
        ['api-key = \'리터럴\'', "api-key = 'abcdef123'"],
        ['client_secret=리터럴', 'CLIENT_SECRET=abcdef123'],
        ['파이썬 password = "리터럴"', 'password = "hunter22"'],
    ])('%s 를 찾는다', (_n, code) => {
        expect(script(code)).toEqual(['code (키·토큰·비밀번호로 보이는 리터럴 값)']);
    });

    it('여러 개가 있어도 code 한 건으로 낸다', () => {
        expect(script('A=sk-abcdefghijklmnop1234\nB=omk_live_abcd1234\npassword=hunter22')).toHaveLength(1);
    });

    it.each([
        ['환경 변수 참조', 'curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com'],
        ['${VAR} 참조', 'password=${DB_PASSWORD}'],
        ['따옴표 안의 $VAR', 'token="$TOKEN"'],
        ['{{param}}', 'api_key="{{api_key}}"'],
        ['명령 치환', 'TOKEN=$(cat ~/.token)'],
        ['짧은 값(5자)', 'token=abc12'],
        ['짧은 Bearer(15자)', 'Bearer abcdefghijklmno'],
        ['짧은 sk-(15자)', 'sk-abcdefghijklmno'],
        ['짧은 omk_live_(7자)', 'omk_live_abc1234'],
        ['마스킹 3자', 'password="***"'],
        ['키 이름만 있고 값 없음', 'read -s -p "password: " PW'],
        ['일반 코드', 'echo $((1+1))'],
    ])('%s 는 걸리지 않는다', (_n, code) => {
        expect(script(code)).toEqual([]);
    });

    it('마스킹이어도 6자 이상이면 리터럴로 본다(현재 규칙)', () => {
        expect(script('password=********')).toHaveLength(1);
    });

    it('빈 입력 — code 가 없거나 빈 문자열이면 빈 목록', () => {
        expect(script(undefined)).toEqual([]);
        expect(script('')).toEqual([]);
    });

    it('스크립트 절차는 actions 를 보지 않는다', () => {
        expect(findPlaintextSecrets({ kind: 'script', code: 'echo hi', actions: [{ type: 'fill', selector: '#password', text: 'x' }] })).toEqual([]);
    });

    // 결함(빈틈): 이름 있는 형식 토큰 중 sk-·omk_live_·bearer 만 본다 — GitHub PAT·AWS 액세스 키·Slack 토큰은
    // 키 이름 없이 박히면 통과한다. 재현: findPlaintextSecrets({ kind:'script', code:'git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r' }) → []
    it.skip('[결함] ghp_·AKIA·xoxb- 형식 토큰을 찾는다', () => {
        expect(script('git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r')).toHaveLength(1);
        expect(script('aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE')).toHaveLength(1);
        expect(script('SLACK=xoxb-123456789012-abcdefghij')).toHaveLength(1);
    });

    // 결함(빈틈): 스크립트 키 이름 규칙에 pass·pwd 가 없다(브라우저 입력란 규칙에는 pwd 가 있다) — 흔한 환경 변수 이름이 통과한다.
    // 재현: findPlaintextSecrets({ kind:'script', code:'DB_PASS=hunter22' }) → [] , code:'MYSQL_PWD=hunter22' → []
    it.skip('[결함] DB_PASS=·MYSQL_PWD= 리터럴을 찾는다', () => {
        expect(script('DB_PASS=hunter22')).toHaveLength(1);
        expect(script('MYSQL_PWD=hunter22 mysql')).toHaveLength(1);
    });

    // 결함(거짓 양성): 파이썬에서 비밀을 환경 변수·입력으로 읽는 "권장" 형태가 리터럴로 걸려 저장이 거절된다.
    // 값 클래스 [^\s"'${}] 가 식(os.environ.get(...)·getpass.getpass())도 6자 이상 리터럴로 본다.
    // 재현: findPlaintextSecrets({ kind:'script', lang:'python', code:"token = os.environ.get('TOKEN')" }) → ['code (…)']
    it.skip('[결함] 파이썬 환경 변수·입력 읽기는 걸리지 않는다', () => {
        expect(findPlaintextSecrets({ kind: 'script', lang: 'python', code: "token = os.environ.get('TOKEN')" })).toEqual([]);
        expect(findPlaintextSecrets({ kind: 'script', lang: 'python', code: 'password = getpass.getpass()' })).toEqual([]);
        expect(findPlaintextSecrets({ kind: 'script', lang: 'python', code: 'api_key = settings.API_KEY' })).toEqual([]);
    });
});
