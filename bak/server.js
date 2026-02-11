const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// .env 로드 (dotenv가 설치되어 있으면 사용)
try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        require('dotenv').config({ path: envPath });
    }
} catch (e) {
    // dotenv 없이도 동작 가능 (환경변수가 직접 설정된 경우)
}

// #23 개선: 환경변수 검증 (서버 시작 전 조기 발견)
(function validateEnv() {
    const errors = [];
    const warnings = [];
    const isProd = process.env.NODE_ENV === 'production';

    // 포트 검증
    if (process.env.PORT) {
        const port = parseInt(process.env.PORT, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
            errors.push(`PORT: 유효한 포트 번호여야 합니다 (1-65535), 현재: ${process.env.PORT}`);
        }
    }

    // 프로덕션 필수 환경변수 검증
    const prodRequired = [
        { name: 'JWT_SECRET', minLen: 32, desc: 'JWT 서명 시크릿 (최소 32자)' },
        { name: 'SESSION_SECRET', minLen: 16, desc: '세션 시크릿 (최소 16자)' },
        { name: 'ADMIN_PASSWORD', minLen: 8, desc: '관리자 비밀번호 (최소 8자)' },
    ];

    for (const v of prodRequired) {
        const val = process.env[v.name];
        if (!val) {
            if (isProd) {
                errors.push(`${v.name}: 프로덕션 환경에서 필수 (${v.desc})`);
            } else {
                warnings.push(`${v.name}: 설정 권장 (${v.desc})`);
            }
        } else if (val.length < v.minLen) {
            errors.push(`${v.name}: 최소 ${v.minLen}자 이상이어야 합니다 (현재 ${val.length}자)`);
        }
    }

    // Google OAuth 쌍 검증
    if (process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_SECRET) {
        errors.push('GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_ID 설정 시 필수');
    }
    if (process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_CLIENT_ID) {
        errors.push('GOOGLE_CLIENT_ID: GOOGLE_CLIENT_SECRET 설정 시 필수');
    }

    // URL 검증
    if (process.env.OLLAMA_BASE_URL) {
        if (!process.env.OLLAMA_BASE_URL.startsWith('http://') && !process.env.OLLAMA_BASE_URL.startsWith('https://')) {
            errors.push(`OLLAMA_BASE_URL: http:// 또는 https://로 시작해야 합니다`);
        }
    }

    // 토큰 암호화 키 경고
    if (isProd && !process.env.TOKEN_ENCRYPTION_KEY) {
        warnings.push('TOKEN_ENCRYPTION_KEY: 미설정 시 폴백 키 사용 (프로덕션에서 권장)');
    }

    // 결과 출력
    if (warnings.length > 0) {
        console.warn('[Config] ⚠️  환경변수 경고:');
        warnings.forEach(w => console.warn(`  ⚠️  ${w}`));
    }

    if (errors.length > 0) {
        console.error('[Config] ❌ 환경변수 검증 실패:');
        errors.forEach(e => console.error(`  ❌ ${e}`));
        console.error('[Config] .env.example을 참고하여 필수 환경변수를 설정하세요.');
        if (isProd) {
            process.exit(1);
        }
    } else {
        console.log('[Config] ✅ 환경변수 검증 통과');
    }
})();

console.log('🚀 OpenMake 서버 시작 중...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const cliPath = path.join(__dirname, 'backend', 'api', 'dist', 'cli.js');
const port = process.env.PORT || 52416;

console.log('CLI 경로:', cliPath);
console.log('포트:', port);

const server = spawn('node', [cliPath, 'cluster', '-p', port], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production', PORT: port },
    stdio: 'inherit'
});

server.on('error', (err) => {
    console.error('❌ 서버 시작 실패:', err);
    process.exit(1);
});

server.on('exit', (code) => {
    console.log(`서버 종료 (코드: ${code})`);
    if (code !== 0) {
        process.exit(code);
    }
});

console.log('✅ 서버 프로세스 시작됨 (PID:', server.pid, ')');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🌐 대시보드: http://localhost:' + port);
console.log('🏥 Health: http://localhost:' + port + '/health');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// #25 개선: graceful shutdown 강화
// SIGINT + SIGTERM 모두 처리
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Shutdown] ${signal} 수신. 서버 종료 중...`);
    server.kill(signal);

    // 10초 후 강제 종료
    const forceExitTimer = setTimeout(() => {
        console.error('[Shutdown] 서버가 응답하지 않아 강제 종료합니다.');
        server.kill('SIGKILL');
        process.exit(1);
    }, 10000);

    // timer가 프로세스 종료를 막지 않도록
    forceExitTimer.unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
