#!/usr/bin/env node

/**
 * Direct Server Launcher
 * CLI를 우회하여 서버를 직접 시작합니다
 */

const path = require('path');

// 환경 변수 로드 (PORT 읽기 전에 먼저 로드)
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const PORT = process.env.PORT;

console.log('🚀 OpenMake Direct Server Launcher');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📁 Working Directory: ${__dirname}`);
console.log(`📦 Port: ${PORT || '(default from config)'}`);
console.log('');

// Dashboard 서버 직접 시작
async function startServer() {
    try {
        console.log('📦 Loading dashboard module...');

        // dist/server.js 모듈을 절대 경로로 import
        const serverPath = path.join(__dirname, 'dist', 'server.js');
        const serverModule = require(serverPath);

        if (!serverModule.createDashboardServer) {
            throw new Error('createDashboardServer function not found in server module');
        }

        console.log('✅ Dashboard module loaded');
        console.log('🎯 Creating dashboard server...');

        const portNum = PORT ? parseInt(PORT, 10) : undefined;
        const dashboard = serverModule.createDashboardServer(
            portNum ? { port: portNum } : undefined
        );

        console.log('🚀 Starting server...');
        await dashboard.start();

        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`✅ Server running at: ${dashboard.url}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('Press Ctrl+C to stop the server');
        console.log('');

        // 종료 처리
        process.on('SIGINT', () => {
            console.log('\n\n👋 Shutting down server...');
            dashboard.stop();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n\n👋 Shutting down server...');
            dashboard.stop();
            process.exit(0);
        });

    } catch (error) {
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ Server startup failed!');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('');
        console.error('Error:', error.message);
        console.error('');
        if (error.code === 'MODULE_NOT_FOUND') {
            console.error('Missing module:', error.message);
            console.error('');
            console.error('Troubleshooting:');
            console.error('1. Run: cd /Volumes/MAC_APP/ollama/openmake/backend/api');
            console.error('2. Run: npm run build');
            console.error('3. Try again: node start-direct.js');
        } else {
            console.error('Stack:', error.stack);
        }
        console.error('');
        process.exit(1);
    }
}

// 서버 시작
startServer();
