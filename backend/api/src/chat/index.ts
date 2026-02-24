/**
 * ============================================================
 * CLI Chat Session - 터미널 대화 세션 오케스트레이션
 * ============================================================
 * 대화형 CLI 루프, 명령 처리(clear/help/exit), 모델 호출 및
 * 스트리밍 출력 로직을 제공합니다.
 *
 * @module chat/index
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { OllamaClient } from '../ollama/client';
import {
    ChatMessage,
    ModelOptions,
    MODEL_PRESETS
} from '../ollama/types';
import { getSystemPrompt } from './prompt';
import { showCompactBanner, showModelInfo, showDivider } from '../ui/banner';
import { createSpinner } from '../ui/spinner';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('ChatModule');

export interface ChatOptions {
    model?: string;
    systemPrompt?: string;
}

export class ChatSession {
    private client: OllamaClient;
    private messages: ChatMessage[] = [];
    private systemPrompt: string;
    private modelOptions: ModelOptions;

    constructor(client: OllamaClient, options: ChatOptions = {}) {
        this.client = client;

        // Gemini 모델 전용 프리셋 사용 (추론 모드 지원)
        this.modelOptions = MODEL_PRESETS.GEMINI_DEFAULT;
        // 기본 프롬프트: 전문가 수준의 상세한 답변 제공
        this.systemPrompt = options.systemPrompt || getSystemPrompt('assistant');

        if (options.model) {
            this.client.setModel(options.model);
        }

        this.messages.push({
            role: 'system',
            content: this.systemPrompt
        });
    }

    async start(): Promise<void> {
        showCompactBanner();
        showModelInfo(this.client.model);

        // Gemini 모드 표시
        logger.info(chalk.magenta(`  🎯  Mode: Gemini Optimized`));

        showDivider();

        logger.info(chalk.gray('채팅을 시작합니다. "exit" 또는 "quit"을 입력하면 종료됩니다.\n'));

        await this.loop();
    }

    private async loop(): Promise<void> {
        while (true) {
            const { input } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'input',
                    message: chalk.green('You:'),
                    prefix: ''
                }
            ]);

            const trimmed = input.trim();

            if (!trimmed) continue;

            if (['exit', 'quit', 'q', '종료'].includes(trimmed.toLowerCase())) {
                logger.info(chalk.yellow('\n👋 채팅을 종료합니다.'));
                break;
            }

            if (trimmed.toLowerCase() === 'clear') {
                this.clearHistory();
                logger.info(chalk.cyan('💬 대화 기록이 초기화되었습니다.\n'));
                continue;
            }

            if (trimmed.toLowerCase() === 'help') {
                this.showHelp();
                continue;
            }

            await this.sendMessage(trimmed);
        }
    }

    private async sendMessage(content: string): Promise<void> {
        this.messages.push({ role: 'user', content });

        const spinner = createSpinner('생각 중...');
        spinner.start();

        try {
            let firstToken = true;

            const response = await this.client.chat(
                this.messages,
                this.modelOptions,
                (token) => {
                    if (firstToken) {
                        spinner.stop();
                        process.stdout.write(chalk.cyan('\n🤖 AI: '));
                        firstToken = false;
                    }
                    process.stdout.write(token);
                }
            );

            if (firstToken) {
                spinner.stop();
                logger.info(chalk.cyan('\n🤖 AI: ') + response.content);
            } else {
                logger.info('\n');
            }

            this.messages.push(response);
        } catch (error) {
            spinner.fail('응답 생성 실패');

            if (error instanceof Error) {
                if (error.message.includes('ECONNREFUSED')) {
                    logger.info(chalk.red('\n❌ Ollama 서버에 연결할 수 없습니다.'));
                    logger.info(chalk.yellow('   ollama serve 명령으로 서버를 시작하세요.\n'));
                } else {
                    logger.info(chalk.red(`\n❌ 오류: ${error.message}\n`));
                }
            }

            // 실패한 메시지 제거
            this.messages.pop();
        }
    }

    private clearHistory(): void {
        this.messages = [{
            role: 'system',
            content: this.systemPrompt
        }];
        this.client.clearContext();
    }

    private showHelp(): void {
        logger.info(chalk.cyan('\n📖 도움말'));
        showDivider();
        logger.info(chalk.white('  clear  ') + chalk.gray('- 대화 기록 초기화'));
        logger.info(chalk.white('  help   ') + chalk.gray('- 도움말 표시'));
        logger.info(chalk.white('  exit   ') + chalk.gray('- 채팅 종료'));
        logger.info('');
    }
}

export async function startChat(client: OllamaClient, options?: ChatOptions): Promise<void> {
    const session = new ChatSession(client, options);
    await session.start();
}
