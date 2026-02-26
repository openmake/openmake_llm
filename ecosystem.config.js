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
 */
module.exports = {
    apps: [{
        name: 'openmake-llm',
        script: 'backend/api/dist/cli.js',
        args: 'cluster --port 52416',
        cwd: '/Volumes/MAC_APP/openmake_llm',
        
        // 환경 설정
        env: {
            NODE_ENV: 'production',
            PORT: 52416,
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
    }],
};
