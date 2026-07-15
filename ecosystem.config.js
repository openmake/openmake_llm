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
module.exports = {
    apps: [{
        name: 'openmake-llm',
        script: 'apps/api/dist/cli.js',
        args: 'cluster --port 52416',
        cwd: __dirname,
        
        // 환경 설정
        env: {
            NODE_ENV: 'production',
            PORT: 52416,
            // 문서 첨부 추출(opendataloader-pdf)은 Java 11+ 가 필요하다.
            // pm2 프로세스가 JVM 을 찾도록 JAVA_HOME 과 PATH 에 openjdk@17 을 주입.
            JAVA_HOME: '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
            PATH: '/opt/homebrew/opt/openjdk@17/bin:' + (process.env.PATH || ''),
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
        error_file: '/tmp/openmake-llm-error.log',
        out_file: '/tmp/openmake-llm-out.log',
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
        cwd: __dirname + '/apps/web',
        // npm 을 fork 하면 pm2 ProcessContainerFork 가 crash → next 바이너리를 직접 node 로 실행.
        script: './node_modules/next/dist/bin/next',
        args: 'start -p 3000',
        env: {
            NODE_ENV: 'production',
            PORT: 3000,
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
        error_file: '/tmp/openmake-next-error.log',
        out_file: '/tmp/openmake-next-out.log',
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }, {
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
        error_file: '/tmp/openmake-discord-error.log',
        out_file: '/tmp/openmake-discord-out.log',
        merge_logs: true,
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }],
};
