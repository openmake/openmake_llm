/**
 * PM2 Ecosystem Configuration
 *
 * 사용법:
 *   pm2 start ecosystem.config.js          # 시작
 *   pm2 restart openmake-llm               # 재시작
 *   pm2 stop openmake-llm                  # 중지
 *   pm2 logs openmake-llm                  # 로그 보기
 *   pm2 monit                              # 모니터링 대시보드
 *   pm2 save && pm2 startup                # 시스템 부팅 시 자동 시작
 *
 * 로그 로테이션 (필수, 1회만 실행):
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 10M
 *   pm2 set pm2-logrotate:retain 30
 *   pm2 set pm2-logrotate:compress true
 *   pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
 *   # /tmp/openmake-llm-*.log 가 10MB 도달 시 회전, 30일 보관, gzip 압축
 *   # 미설정 시 단일 로그 파일이 무한 증가 → 디스크 가득 위험
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** 포트/로그 위치는 .env 나 셸 환경으로 덮어쓸 수 있다 (No-Hardcoding). */
const API_PORT = process.env.PORT || '52416';
const WEB_PORT = process.env.OMK_WEB_PORT || '3000';
/**
 * 로그 디렉터리. 기본은 기존 동작 유지(/tmp)지만, 여러 사용자가 쓰는 리눅스 호스트에서는
 * /tmp/openmake-*.log 소유자 충돌로 PM2 가 EACCES 로 죽는다 → OMK_LOG_DIR 로 분리 가능.
 */
// .env 의 OMK_LOG_DIR 를 존중한다 — `pm2 start` 를 호출한 셸이 .env 를 export 하지 않으므로
// (openmake_llm.sh 도 안 함) 여기서 직접 읽지 않으면 설정이 있어도 /tmp 로 떨어진다.
// /tmp 는 재부팅·주기 정리로 사라져 장애 후 원인 로그가 없을 수 있다(2026-08-27 점검).
try { require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true }); } catch { /* dotenv 없으면 셸 env 만 */ }
const LOG_DIR = process.env.OMK_LOG_DIR || '/tmp';
const logFile = (name) => path.join(LOG_DIR, name);

/**
 * Next 실행 파일 경로 해석.
 * npm workspaces 는 next 를 루트 node_modules 로 hoist 하므로 apps/web/node_modules/next 는
 * 보통 존재하지 않는다(신규 클론에서 프론트가 안 뜨던 원인). require.resolve 로 hoist/nested
 * 양쪽을 모두 처리한다.
 */
function resolveNextBin(webDir) {
    try {
        return require.resolve('next/dist/bin/next', { paths: [webDir, __dirname] });
    } catch {
        return './node_modules/next/dist/bin/next'; // 마지막 수단 — 기존 동작
    }
}

/**
 * JVM 위치를 크로스플랫폼으로 탐지한다 (opendataloader-pdf 의 PDF 텍스트 추출에 필요).
 * 우선순위: 명시적 JAVA_HOME > macOS /usr/libexec/java_home > PATH 의 java 역추적.
 * 못 찾으면 '' 반환 → 라이브러리가 PATH 의 java 로 자체 탐색(있으면 동작, 없으면 PDF 만 비활성).
 * (구 하드코딩 /opt/homebrew/opt/openjdk@17 은 Apple Silicon 전용이라 Intel/Linux 에서 부재였음)
 */
function resolveJavaHome() {
    if (process.env.JAVA_HOME) return process.env.JAVA_HOME;
    try {
        if (process.platform === 'darwin') {
            // macOS 내장 — 활성 JDK home 반환 (Intel/ARM 무관). JDK 없으면 exit 1 → catch.
            return execSync('/usr/libexec/java_home', { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString().trim();
        }
        // Linux/기타 — PATH 의 java 실행파일에서 home 역추적 (…/bin/java → …).
        const javaBin = execSync('command -v java', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
        if (javaBin) {
            const real = execSync(`readlink -f "${javaBin}"`, { stdio: ['ignore', 'pipe', 'ignore'] })
                .toString().trim() || javaBin;
            return path.dirname(path.dirname(real)); // …/bin/java → …
        }
    } catch {
        // java 미설치 — PDF 추출만 비활성, 앱 부팅·기타 기능은 정상.
    }
    return '';
}

const JAVA_HOME = resolveJavaHome();
const JAVA_PATH_PREFIX = JAVA_HOME ? path.join(JAVA_HOME, 'bin') + path.delimiter : '';

const WEB_DIR = path.join(__dirname, 'apps/web');
const DISCORD_ENTRY = path.join(__dirname, 'apps/discord-bot/dist/index.js');

const apps = [{
        name: 'openmake-llm',
        script: 'apps/api/dist/cli.js',
        args: `cluster --port ${API_PORT}`,
        cwd: __dirname,

        // 환경 설정
        env: {
            NODE_ENV: 'production',
            PORT: API_PORT,
            // 문서 첨부 추출(opendataloader-pdf)은 Java 11+ 가 필요하다.
            // pm2 프로세스가 JVM 을 찾도록 자동 탐지한 JAVA_HOME 과 PATH 를 주입 (크로스플랫폼).
            ...(JAVA_HOME ? { JAVA_HOME } : {}),
            PATH: JAVA_PATH_PREFIX + (process.env.PATH || ''),
        },
        
        // 프로세스 관리
        instances: 1,                   // cluster 모드는 cli.js 내부에서 관리
        exec_mode: 'fork',
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 3000,            // 재시작 간 3초 대기
        
        // 메모리 관리
        max_memory_restart: '1G',       // 1GB 초과 시 자동 재시작
        
        // 로그 설정
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        error_file: logFile('openmake-llm-error.log'),
        out_file: logFile('openmake-llm-out.log'),
        merge_logs: true,
        log_type: 'json',
        
        // 파일 감시 (개발용 — production에서는 끔)
        watch: false,
        
        // Graceful shutdown
        kill_timeout: 10000,            // SIGKILL 전 10초 대기
        listen_timeout: 15000,          // 시작 후 15초 내 ready 신호
        
        // 환경 오버라이드
        env_development: {
            NODE_ENV: 'development',
        },
        env_production: {
            NODE_ENV: 'production',
        },
    }, {
        // ── Next.js 프론트엔드 (Lumen) ──────────────────────────────
        // 운영: Nginx 가 / 를 이 앱(:3000)으로, /api·/ws 를 openmake-llm(:52416)으로 프록시.
        // 선행: `npm run build:frontend-next` 로 apps/web/.next 생성 필요.
        name: 'openmake-next',
        cwd: WEB_DIR,
        // npm 을 fork 하면 pm2 ProcessContainerFork 가 crash → next 바이너리를 직접 node 로 실행.
        // (workspaces hoist 때문에 경로는 require.resolve 로 찾는다 — resolveNextBin 주석 참고)
        script: resolveNextBin(WEB_DIR),
        args: `start -p ${WEB_PORT}`,
        env: {
            NODE_ENV: 'production',
            PORT: WEB_PORT,
            // 운영은 same-origin Nginx 프록시이므로 WS 도 same-origin(미설정 시 location.host).
            // API_PROXY_TARGET 은 dev 전용(.env.local). 운영에서 Next rewrites 를 쓰려면 여기서 지정.
        },
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 3000,
        max_memory_restart: '1G',
        error_file: logFile('openmake-next-error.log'),
        out_file: logFile('openmake-next-out.log'),
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }];

// ── Discord Gateway Bot (선택) ────────────────────────────────────────────
// dist 가 없으면 PM2 가 MODULE_NOT_FOUND 로 재시작 루프를 돌다 errored 로 남는다
// (신규 설치는 `npm run build` 에 discord-bot 이 포함되지 않아 항상 이 상태였음).
// 빌드 산출물이 실제로 있을 때만 등록한다.
if (fs.existsSync(DISCORD_ENTRY)) {
    apps.push({
        // ── Discord Gateway Bot ─────────────────────────────────
        // Discord 메시지를 /api/v1/chat/completions 로 중계하는 독립 gateway 프로세스.
        // 선행: 루트 .env 에 DISCORD_BOT_TOKEN·DISCORD_BOT_API_KEY + 접근 제어 설정,
        //       `npm run build:discord-bot` 으로 dist 생성.
        // 설정 미비 시 exit 78 로 스스로 내려가며 stop_exit_codes 가 재시작 루프를 막는다.
        name: 'openmake-discord',
        script: 'apps/discord-bot/dist/index.js',
        cwd: __dirname,
        env: {
            NODE_ENV: 'production',
        },
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        stop_exit_codes: [78],          // EX_CONFIG — 설정 미비 정상 정지
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 3000,
        max_memory_restart: '300M',
        error_file: logFile('openmake-discord-error.log'),
        out_file: logFile('openmake-discord-out.log'),
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    });
}

module.exports = { apps };
