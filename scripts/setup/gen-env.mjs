#!/usr/bin/env node
/**
 * ==============================================================================
 * OpenMake LLM — .env 생성/보수 (idempotent)
 * ==============================================================================
 * .env.example 은 1100줄 넘는 reference 문서라 그대로 복사하면 첫 부팅이 실패한다
 * (JWT_SECRET / API_KEY_PEPPER / TOKEN_ENCRYPTION_KEY / ADMIN_PASSWORD 는 빈 값이면
 *  production 부팅이 중단됨 — apps/api/src/config/env.schema.ts superRefine).
 *
 * 이 스크립트는 "부팅에 필요한 최소 집합"만 실제 값으로 채운 .env 를 만든다.
 * 나머지 선택 설정은 .env.example 에서 필요할 때 골라 붙이면 된다.
 *
 * 동작:
 *   .env 없음  → 신규 생성 (시크릿 랜덤 생성)
 *   .env 있음  → 보수 모드: 빠진 필수 키만 파일 끝에 덧붙임. 기존 값은 절대 건드리지 않음
 *   --force    → 기존 파일을 .env.bak.<타임스탬프> 로 백업하고 새로 생성
 *
 * 사용:
 *   node scripts/setup/gen-env.mjs [--force] [--quiet]
 *
 * 입력(환경변수 — install.sh 가 주입, 미지정 시 기본값):
 *   OMK_PORT(52416) OMK_WEB_PORT(3000) OMK_POSTGRES_PORT(5432) OMK_REDIS_PORT(6379)
 *   OMK_LLM_BASE_URL OMK_LLM_API_KEY OMK_LLM_MODEL
 *   OMK_ADMIN_USERNAME(admin) OMK_ADMIN_EMAIL(admin@openmake.local)
 *
 * 출력: 마지막 줄에 `GENERATED=1` 또는 `REPAIRED=<n>` 또는 `UNCHANGED=0` (install.sh 파싱용)
 * ==============================================================================
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ENV_PATH = path.join(ROOT, '.env');

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const QUIET = argv.includes('--quiet');

const say = (msg) => { if (!QUIET) process.stderr.write(`${msg}\n`); };

/** 64자 hex — JWT_SECRET / API_KEY_PEPPER / TOKEN_ENCRYPTION_KEY (후자는 정확히 64자 강제). */
const hex32 = () => crypto.randomBytes(32).toString('hex');
/** DATABASE_URL 에 그대로 들어가므로 URL 인코딩이 필요없는 문자만 사용. */
const dbPassword = () => crypto.randomBytes(18).toString('hex');
/** 사람이 한 번은 입력할 관리자 비밀번호 — 혼동되는 글자(0/O/l/1) 제외. */
function adminPassword(len = 20) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

const env = (key, fallback) => {
    const v = process.env[key];
    return v !== undefined && v !== '' ? v : fallback;
};

const PORT = env('OMK_PORT', '52416');
const WEB_PORT = env('OMK_WEB_PORT', '3000');
const PG_PORT = env('OMK_POSTGRES_PORT', '5432');
const REDIS_PORT = env('OMK_REDIS_PORT', '6379');
const ADMIN_USERNAME = env('OMK_ADMIN_USERNAME', 'admin');
const ADMIN_EMAIL = env('OMK_ADMIN_EMAIL', 'admin@openmake.local');
const LLM_BASE_URL = env('OMK_LLM_BASE_URL', 'http://localhost:4000');
const LLM_API_KEY = env('OMK_LLM_API_KEY', 'sk-no-key');
const LLM_MODEL = env('OMK_LLM_MODEL', 'qwen3.6-35b-a3b');

const PG_USER = 'openmake';
const PG_DB = 'openmake_llm';

/**
 * 필수 키 정의. value 는 파일 생성 시점에 1회 평가된다.
 * `section` 이 같은 항목끼리 묶여 출력된다.
 */
function buildEntries() {
    const pgPass = dbPassword();
    const adminPass = adminPassword();

    return [
        ['server', 'NODE_ENV', 'production', '실행 모드. dev 로 띄우려면 npm run dev 사용'],
        ['server', 'PORT', PORT, 'API 서버 포트'],
        ['server', 'SERVER_HOST', '0.0.0.0', '바인드 주소'],
        ['server', 'LOG_LEVEL', 'info', 'error | warn | info | debug'],
        ['server', 'OMK_APP_URL', `http://localhost:${WEB_PORT}`, '웹 UI 공개 주소'],
        ['server', 'CORS_ORIGINS', `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT},http://localhost:${PORT}`,
            '쉼표 구분. production 에서 * 는 부팅 거부'],
        ['server', 'COOKIE_SECURE', 'false', 'HTTPS 로 서비스하면 true 로 바꾸세요'],
        ['server', 'ALLOW_INSECURE_COOKIES', 'true',
            'HTTP 로컬 실행 허용(위 COOKIE_SECURE=false 의 명시적 opt-out). HTTPS 배포 시 false'],

        ['secret', 'JWT_SECRET', hex32(), '세션 서명 키 — 바꾸면 모든 로그인 세션이 무효화됨'],
        ['secret', 'API_KEY_PEPPER', hex32(), 'API Key 해시 pepper'],
        ['secret', 'TOKEN_ENCRYPTION_KEY', hex32(), '외부 provider 자격증명 AES-256-GCM 키 (정확히 64 hex)'],

        ['admin', 'ADMIN_PASSWORD', adminPass, '앱이 부팅 시 만드는 관리자 계정 비밀번호'],
        ['admin', 'DEFAULT_ADMIN_EMAIL', ADMIN_EMAIL, '관리자 로그인 email'],
        ['admin', 'ADMIN_EMAILS', ADMIN_EMAIL, '관리자 권한 email 목록(쉼표 구분)'],
        ['admin', 'ADMIN_INITIAL_USERNAME', ADMIN_USERNAME, 'DB 최초 초기화 시 생성되는 계정 (db/init/004)'],
        ['admin', 'ADMIN_INITIAL_EMAIL', ADMIN_EMAIL, ''],
        ['admin', 'ADMIN_INITIAL_PASSWORD', adminPass, 'ADMIN_PASSWORD 와 동일하게 유지'],

        ['infra', 'POSTGRES_USER', PG_USER, 'infra/docker-compose.yml 이 읽음'],
        ['infra', 'POSTGRES_PASSWORD', pgPass, 'DATABASE_URL 의 비밀번호와 반드시 동일해야 함'],
        ['infra', 'POSTGRES_DB', PG_DB, ''],
        ['infra', 'POSTGRES_PORT', PG_PORT, ''],
        ['infra', 'DATABASE_URL', `postgresql://${PG_USER}:${pgPass}@127.0.0.1:${PG_PORT}/${PG_DB}`, ''],
        ['infra', 'REDIS_PORT', REDIS_PORT, ''],
        ['infra', 'REDIS_URL', `redis://127.0.0.1:${REDIS_PORT}`, ''],
        ['infra', 'STORAGE_BACKEND', 'redis', 'memory | redis. cluster 모드에서는 redis 필요'],

        ['llm', 'LLM_BASE_URL', LLM_BASE_URL, 'OpenAI 호환 엔드포인트 (LiteLLM/vLLM/Ollama/OpenRouter …)'],
        ['llm', 'LLM_API_KEY', LLM_API_KEY, '인증 없는 로컬 프록시면 sk-no-key 유지'],
        ['llm', 'LLM_DEFAULT_MODEL', LLM_MODEL, '위 엔드포인트가 실제로 서빙하는 모델 ID'],
    ];
}

const SECTION_TITLES = {
    server: '서버 / 네트워크',
    secret: '시크릿 (자동 생성됨 — 유출 금지, 재생성 시 세션·저장된 키가 무효화됨)',
    admin: '관리자 계정',
    infra: 'PostgreSQL / Redis (infra/docker-compose.yml 과 공유)',
    llm: 'LLM 백엔드 (OpenAI 호환)',
};

function render(entries) {
    const lines = [
        '# ==============================================================================',
        '# OpenMake LLM — 로컬 실행 설정 (install.sh 가 생성)',
        '# ==============================================================================',
        '# 부팅에 필요한 최소 집합만 들어있습니다.',
        '# 선택 기능(OAuth, 웹검색 API, MCP 샌드박스, Discord 봇 등)은 .env.example 에서',
        '# 필요한 항목만 골라 아래에 덧붙이세요.',
        '#',
        '# 이 파일은 .gitignore 대상입니다. 커밋하지 마세요.',
        '# ==============================================================================',
        '',
    ];

    let current = null;
    for (const [section, key, value, comment] of entries) {
        if (section !== current) {
            current = section;
            lines.push(`# ── ${SECTION_TITLES[section]} ${'─'.repeat(Math.max(3, 60 - SECTION_TITLES[section].length))}`);
        }
        if (comment) lines.push(`# ${comment}`);
        lines.push(`${key}=${value}`);
        lines.push('');
    }
    return lines.join('\n');
}

/** .env 에서 선언된 키 목록만 추출 (값 파싱은 하지 않는다 — 보수 판정용). */
function declaredKeys(text) {
    const keys = new Set();
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (m) keys.add(m[1]);
    }
    return keys;
}

function timestamp() {
    // Date 대신 파일 mtime 기반 고유값이 필요 없으므로 단순 난수 접미사를 쓴다.
    return crypto.randomBytes(4).toString('hex');
}

function main() {
    const exists = fs.existsSync(ENV_PATH);

    if (exists && FORCE) {
        const backup = `${ENV_PATH}.bak.${timestamp()}`;
        fs.copyFileSync(ENV_PATH, backup);
        say(`기존 .env 백업 → ${path.relative(ROOT, backup)}`);
    }

    if (!exists || FORCE) {
        fs.writeFileSync(ENV_PATH, render(buildEntries()), { mode: 0o600 });
        say(`.env 생성 완료 (권한 600)`);
        process.stdout.write('GENERATED=1\n');
        return;
    }

    // ── 보수 모드: 빠진 필수 키만 덧붙인다 ──────────────────────────────────
    const text = fs.readFileSync(ENV_PATH, 'utf8');
    const present = declaredKeys(text);
    const missing = buildEntries().filter(([, key]) => !present.has(key));

    if (missing.length === 0) {
        say('.env 에 필수 키가 모두 있습니다 — 변경 없음');
        process.stdout.write('UNCHANGED=0\n');
        return;
    }

    // 보수로 채운 DATABASE_URL/POSTGRES_PASSWORD 가 서로 어긋나는 사고를 막는다:
    // 둘 중 하나만 빠졌다면 자동 생성 값이 기존 값과 불일치할 수 있으므로 경고한다.
    const pgPair = ['POSTGRES_PASSWORD', 'DATABASE_URL'];
    const missingKeys = missing.map(([, k]) => k);
    if (pgPair.some((k) => missingKeys.includes(k)) && !pgPair.every((k) => missingKeys.includes(k))) {
        say('⚠ POSTGRES_PASSWORD 와 DATABASE_URL 중 하나만 없습니다.');
        say('  자동 생성 값이 기존 값과 다를 수 있으니 두 값의 비밀번호가 같은지 직접 확인하세요.');
    }

    const appended = [
        '',
        '# ── install.sh 자동 보완 (빠져 있던 필수 키) ─────────────────────',
        ...missing.flatMap(([, key, value, comment]) =>
            (comment ? [`# ${comment}`] : []).concat([`${key}=${value}`])),
        '',
    ].join('\n');

    fs.appendFileSync(ENV_PATH, appended);
    say(`.env 보수 완료 — ${missing.length}개 키 추가: ${missingKeys.join(', ')}`);
    process.stdout.write(`REPAIRED=${missing.length}\n`);
}

main();
