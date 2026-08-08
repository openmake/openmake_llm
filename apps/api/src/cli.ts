#!/usr/bin/env node

/**
 * ============================================================
 * CLI Entry - OpenMake 명령행 인터페이스
 * ============================================================
 * 서버 운영 명령(cluster/nodes/mcp/backfill-memories)을 Commander 기반으로
 * 등록하고 실행합니다. 프로덕션 진입점은 `cli.js cluster --port <port>`.
 * (구 coder 개발용 서브커맨드(chat/ask/review/generate/explain/models/connect/plugins)는
 *  2026-08-08 제거 — 서버 경로 미사용, ~/.openmake-coder 플러그인 실재 0)
 *
 * @module cli
 */

// 환경 변수 로드 (최상단에서 실행)
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// .env 파일 경로 탐색 (현재 디렉토리 -> 상위 디렉토리 -> 프로젝트 루트)
const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),  // openmake/openmake/.env
];

for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        console.log(`[dotenv] Loading: ${envPath}`);
        dotenv.config({ path: envPath });
        break;
    }
}

import { Command } from 'commander';
import chalk from 'chalk';
import { showBanner } from './ui/banner';
import { createSpinner } from './ui/spinner';
import { createMCPServer } from './mcp/server';
import { getConfig, APP_VERSION } from './config';

const VERSION = APP_VERSION;
const envConfig = getConfig();
/** cluster.start() 후 노드 상태 동기화를 기다리는 짧은 지연 (ms) */
const CLUSTER_STATUS_REFRESH_DELAY_MS = 1000;

const program = new Command();

program
    .name('openmake-coder')
    .description('AI 어시스턴트 - vLLM/LiteLLM LLM 백엔드')
    .version(VERSION);

// cluster 명령어
program
    .command('cluster')
    .description('클러스터 모드 시작 (대시보드 포함)')
    .option('-p, --port <port>', '대시보드 포트', String(envConfig.port))
    .action(async (options) => {
        showBanner(VERSION);
        console.log(chalk.cyan('\n🔮 OpenMake 클러스터 시작 중...\n'));

        const { createDashboardServer } = await import('./dashboard');
        const dashboard = createDashboardServer({ port: parseInt(options.port) });

        const spinner = createSpinner('노드 연결 중...');
        spinner.start();

        try {
            await dashboard.start();
            spinner.succeed('클러스터 시작됨');

            console.log(chalk.green(`\n✅ 대시보드: ${chalk.underline(dashboard.url)}`));
            console.log(chalk.gray('\n종료하려면 Ctrl+C를 누르세요\n'));

            // 종료 처리
            process.on('SIGINT', () => {
                console.log(chalk.yellow('\n\n👋 클러스터 종료 중...'));
                dashboard.stop();
                process.exit(0);
            });
        } catch (error) {
            spinner.fail('클러스터 시작 실패');
            if (error instanceof Error) {
                console.log(chalk.red(`\n❌ 오류: ${error.message}\n`));
            }
            process.exit(1);
        }
    });

// nodes 명령어
program
    .command('nodes')
    .description('클러스터 노드 목록')
    .action(async () => {
        const { getClusterManager } = await import('./cluster');
        const cluster = getClusterManager();

        const spinner = createSpinner('노드 검색 중...');
        spinner.start();

        await cluster.start();

        // 잠시 대기하여 상태 업데이트
        await new Promise(r => setTimeout(r, CLUSTER_STATUS_REFRESH_DELAY_MS));

        const nodes = cluster.getNodes();
        const stats = cluster.getStats();
        spinner.stop();

        console.log(chalk.cyan('\n🖥️ 클러스터 노드\n'));

        if (nodes.length === 0) {
            console.log(chalk.gray('  연결된 노드가 없습니다.'));
            console.log(chalk.gray('  .env 또는 .llm-cluster.json에 노드를 추가하세요.\n'));
        } else {
            for (const node of nodes) {
                const status = node.status === 'online'
                    ? chalk.green('● 온라인')
                    : chalk.red('○ 오프라인');
                const latency = node.latency ? chalk.gray(`(${node.latency}ms)`) : '';

                console.log(`  ${status} ${chalk.white(node.name)} ${latency}`);
                console.log(chalk.gray(`      ${node.host}:${node.port}`));
                if (node.models.length > 0) {
                    console.log(chalk.gray(`      모델: ${node.models.slice(0, 3).join(', ')}${node.models.length > 3 ? '...' : ''}`));
                }
                console.log('');
            }

            console.log(chalk.cyan(`📊 통계: ${stats.onlineNodes}/${stats.totalNodes} 온라인, ${stats.uniqueModels.length} 모델\n`));
        }

        cluster.stop();
    });

// mcp 명령어 (MCP 서버 모드)
program
    .command('mcp')
    .description('MCP 서버 모드로 실행')
    .action(async () => {
        const server = createMCPServer('openmake-coder', VERSION);
        await server.start();
    });

// backfill-memories 명령어 — 과거 대화(#3 c)에서 사용자 메모리 일회성 추출/저장
program
    .command('backfill-memories <userId>')
    .description('과거 대화에서 사용자 메모리를 LLM 추출해 저장(#3 c). --dry-run 으로 저장 없이 미리보기.')
    .option('--dry-run', '저장하지 않고 추출 후보만 출력')
    .option('--max-sessions <n>', '분석할 최근 세션 수', '30')
    .action(async (userId, options) => {
        const { backfillUserMemories } = await import('./services/chat-service/memory-backfill');
        const dryRun = !!options.dryRun;
        console.log(chalk.cyan(`\n🧠 메모리 백필 ${dryRun ? '(dry-run)' : ''} — user ${userId}\n`));
        const spinner = createSpinner('과거 세션 분석 중...');
        spinner.start();
        try {
            const r = await backfillUserMemories(userId, { dryRun, maxSessions: parseInt(options.maxSessions, 10) });
            spinner.succeed(`세션 ${r.sessionsProcessed} 처리 · 후보 ${r.candidateCount} · 신규 ${r.fresh.length} · 저장 ${r.saved} · 중복 ${r.skippedDup}`);
            if (r.fresh.length > 0) {
                console.log(chalk.cyan(`\n${dryRun ? '추출 후보(미저장)' : '저장된 메모리'}:`));
                r.fresh.forEach((m, i) => console.log(chalk.white(`  ${i + 1}. ${m}`)));
            }
            console.log('');
        } catch (e) {
            spinner.fail('백필 실패');
            console.log(chalk.red(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`));
            process.exit(1);
        }
        process.exit(0);
    });

// 기본 명령 (인수 없이 실행 시)
program
    .action(async () => {
        showBanner(VERSION);
        program.help();
    });

program.parse(process.argv);
