#!/usr/bin/env node

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
import { createClient } from './ollama/client';
import { startChat } from './chat';
import { reviewFile } from './commands/review';
import { generateCode } from './commands/generate';
import { explainFile } from './commands/explain';
import { showBanner, showDivider } from './ui/banner';
import { createSpinner } from './ui/spinner';
import { createMCPServer } from './mcp/server';
import { createPluginLoader } from './plugins/loader';
import { getConfig } from './config';

const VERSION = '1.4.1';
const envConfig = getConfig();
const DEFAULT_MODEL = envConfig.ollamaDefaultModel;

const program = new Command();

program
    .name('ollama-coder')
    .description('AI 어시스턴트 - Ollama LLM 백엔드')
    .version(VERSION);

// chat 명령어
program
    .command('chat')
    .description('대화형 AI 어시스턴트 시작')
    .option('-m, --model <model>', '사용할 모델', DEFAULT_MODEL)
    .action(async (options) => {
        showBanner(VERSION);

        const client = createClient({ model: options.model });

        const spinner = createSpinner('Ollama 연결 확인 중...');
        spinner.start();

        const available = await client.isAvailable();
        if (!available) {
            spinner.fail('Ollama 서버에 연결할 수 없습니다');
            console.log(chalk.yellow('\n💡 Ollama를 시작하려면: ollama serve\n'));
            process.exit(1);
        }

        spinner.succeed('Ollama 연결됨');

        // 플러그인 로드
        const loader = createPluginLoader({ ollamaModel: options.model });
        await loader.loadAll();

        const plugins = loader.getLoadedPlugins();
        if (plugins.length > 0) {
            console.log(chalk.gray(`\n📦 ${plugins.length}개 플러그인 로드됨`));
        }

        await startChat(client, { model: options.model });
    });

// ask 명령어
program
    .command('ask <question>')
    .description('단일 질문하기')
    .option('-m, --model <model>', '사용할 모델', DEFAULT_MODEL)
    .action(async (question, options) => {
        const client = createClient({ model: options.model });

        const spinner = createSpinner('생각 중...');
        spinner.start();

        try {
            let firstToken = true;

            await client.generate(
                question,
                { temperature: 0.7 },
                (token) => {
                    if (firstToken) {
                        spinner.stop();
                        console.log(chalk.cyan('\n🤖 AI: '));
                        firstToken = false;
                    }
                    process.stdout.write(token);
                }
            );

            console.log('\n');
        } catch (error) {
            spinner.fail('응답 생성 실패');
            if (error instanceof Error) {
                console.log(chalk.red(`\n❌ 오류: ${error.message}\n`));
            }
        }
    });

// review 명령어
program
    .command('review <file>')
    .description('코드 파일 리뷰')
    .option('-m, --model <model>', '사용할 모델', DEFAULT_MODEL)
    .action(async (file, options) => {
        const client = createClient({ model: options.model });
        await reviewFile(client, file);
    });

// generate 명령어
program
    .command('generate <description>')
    .description('설명에서 코드 생성')
    .option('-m, --model <model>', '사용할 모델', DEFAULT_MODEL)
    .option('-o, --output <file>', '출력 파일')
    .option('-l, --language <lang>', '프로그래밍 언어')
    .action(async (description, options) => {
        const client = createClient({ model: options.model });
        await generateCode(client, description, {
            output: options.output,
            language: options.language
        });
    });

// explain 명령어
program
    .command('explain <file>')
    .description('코드 파일 설명')
    .option('-m, --model <model>', '사용할 모델', DEFAULT_MODEL)
    .action(async (file, options) => {
        const client = createClient({ model: options.model });
        await explainFile(client, file);
    });

// models 명령어
program
    .command('models')
    .description('사용 가능한 모델 목록')
    .action(async () => {
        const client = createClient();

        const spinner = createSpinner('모델 목록 조회 중...');
        spinner.start();

        try {
            const response = await client.listModels();
            spinner.stop();

            console.log(chalk.cyan('\n📦 사용 가능한 모델:\n'));

            for (const model of response.models) {
                const size = (model.size / 1024 / 1024 / 1024).toFixed(1);
                console.log(chalk.white(`  • ${model.name}`) + chalk.gray(` (${size} GB)`));
            }

            console.log(chalk.gray(`\n현재 기본 모델: ${DEFAULT_MODEL}\n`));
        } catch (error) {
            spinner.fail('모델 목록 조회 실패');
            if (error instanceof Error) {
                console.log(chalk.red(`\n❌ 오류: ${error.message}\n`));
            }
        }
    });

// connect 명령어 (연결 테스트)
program
    .command('connect')
    .description('Ollama 서버 연결 테스트')
    .action(async () => {
        console.log(chalk.cyan('\n🔗 Ollama 연결 테스트\n'));
        console.log(chalk.gray(`   서버 URL: ${envConfig.ollamaBaseUrl}`));
        console.log(chalk.gray(`   기본 모델: ${envConfig.ollamaDefaultModel}`));
        console.log('');

        const spinner = createSpinner('연결 확인 중...');
        spinner.start();

        const client = createClient();
        const available = await client.isAvailable();

        if (available) {
            spinner.succeed('Ollama 서버 연결 성공!');

            try {
                const models = await client.listModels();
                console.log(chalk.green(`\n✅ ${models.models.length}개 모델 발견:\n`));
                for (const model of models.models) {
                    const size = (model.size / 1024 / 1024 / 1024).toFixed(1);
                    console.log(chalk.white(`   • ${model.name}`) + chalk.gray(` (${size} GB)`));
                }
            } catch (e) {
                console.log(chalk.yellow('\n⚠️ 모델 목록 조회 실패'));
            }
        } else {
            spinner.fail('Ollama 서버 연결 실패');
            console.log(chalk.yellow(`\n💡 다음 사항을 확인하세요:`));
            console.log(chalk.gray(`   1. Ollama 서버가 실행 중인지 확인`));
            console.log(chalk.gray(`   2. 원격 서버인 경우: OLLAMA_HOST=0.0.0.0 ollama serve`));
            console.log(chalk.gray(`   3. 방화벽에서 11434 포트 허용`));
            console.log(chalk.gray(`   4. .env 파일에서 OLLAMA_BASE_URL 확인`));
        }
        console.log('');
    });

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
        await new Promise(r => setTimeout(r, 1000));

        const nodes = cluster.getNodes();
        const stats = cluster.getStats();
        spinner.stop();

        console.log(chalk.cyan('\n🖥️ 클러스터 노드\n'));

        if (nodes.length === 0) {
            console.log(chalk.gray('  연결된 노드가 없습니다.'));
            console.log(chalk.gray('  .env 또는 .ollama-cluster.json에 노드를 추가하세요.\n'));
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
        const server = createMCPServer('ollama-coder', VERSION);
        await server.start();
    });

// plugins 명령어
program
    .command('plugins')
    .description('플러그인 관리')
    .option('--list', '설치된 플러그인 목록')
    .option('--dir', '플러그인 디렉토리 표시')
    .action(async (options) => {
        const loader = createPluginLoader();

        if (options.dir) {
            console.log(chalk.cyan('\n📁 플러그인 디렉토리:'));
            console.log(`   ${loader.getPluginsDirectory()}\n`);
            return;
        }

        await loader.loadAll();
        const plugins = loader.getLoadedPlugins();

        console.log(chalk.cyan('\n🔌 설치된 플러그인:\n'));

        if (plugins.length === 0) {
            console.log(chalk.gray('  플러그인이 없습니다.'));
            console.log(chalk.gray(`  플러그인 디렉토리: ${loader.getPluginsDirectory()}\n`));
        } else {
            for (const plugin of plugins) {
                console.log(chalk.white(`  • ${plugin.name}`) + chalk.gray(` v${plugin.version}`));
                if (plugin.description) {
                    console.log(chalk.gray(`    ${plugin.description}`));
                }
            }
            console.log('');
        }
    });

// 기본 명령 (인수 없이 실행 시)
program
    .action(async () => {
        showBanner(VERSION);
        program.help();
    });

program.parse(process.argv);
