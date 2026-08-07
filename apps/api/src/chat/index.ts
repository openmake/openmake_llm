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
import * as os from 'os';
import { LLMClient } from '../llm';
import {
    ChatMessage,
    ModelOptions,
} from '../llm';
import { MODEL_PRESETS } from '../config/llm-parameters';
import { getSystemPrompt } from './prompt';
import { showCompactBanner, showModelInfo, showDivider } from '../ui/banner';
import { createSpinner } from '../ui/spinner';
import { createLogger } from '../utils/logger';
import { getConversationDB } from '../data/conversation-db';
import { closeDatabase } from '../data/models/unified-database';

const logger = createLogger('ChatModule');

/** CLI 발 세션 식별 마커 — conversation_sessions.metadata.source 값 (admin 화면 'CLI' 뱃지) */
export const CLI_SESSION_SOURCE = 'cli';

export interface ChatOptions {
    model?: string;
    systemPrompt?: string;
}

export class ChatSession {
    private client: LLMClient;
    private messages: ChatMessage[] = [];
    private systemPrompt: string;
    private modelOptions: ModelOptions;
    /** 현재 대화가 기록 중인 conversation_sessions.id (첫 교환 성공 시 생성, clear 시 리셋) */
    private convSessionId: string | null = null;
    /** DB 접근 실패 시 true — 이후 저장 시도를 중단해 매 턴 연결 대기를 막는다 (fail-open) */
    private persistDisabled = false;
    /** 이번 실행에서 한 번이라도 저장했는지 — 종료 시 pool 정리 여부 판단 */
    private persisted = false;

    constructor(client: LLMClient, options: ChatOptions = {}) {
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

        // 저장에 사용한 pg pool 이 이벤트 루프를 잡아 프로세스 종료를 막지 않도록 정리
        if (this.persisted) {
            await closeDatabase().catch(() => undefined);
        }
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
            await this.persistExchange(content, response.content ?? '');
        } catch (error) {
            spinner.fail('응답 생성 실패');

            if (error instanceof Error) {
                if (error.message.includes('ECONNREFUSED')) {
                    logger.info(chalk.red('\n❌ LLM 서버 (vLLM/LiteLLM) 에 연결할 수 없습니다.'));
                    logger.info(chalk.yellow('   .env 의 LLM_BASE_URL 을 확인하고 vLLM/LiteLLM 을 기동하세요.\n'));
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
        // 기록 초기화 = 새 대화 — 다음 교환부터 새 세션에 저장
        this.convSessionId = null;
    }

    /**
     * 성공한 질문/답변 한 쌍을 conversation DB 에 저장한다 (fail-open).
     *
     * CLI 는 인증 주체가 없어 userId/anonSessionId 없이 저장하며, 소유권 검증
     * (evaluateSessionAccess) 특성상 관리자만 열람 가능하다. metadata.source='cli'
     * 마커로 admin 화면(/admin/conversations)에서 'CLI' 뱃지로 구분된다.
     * DB 연결 실패 시 경고 1회 후 이후 저장을 중단해 채팅 흐름을 막지 않는다.
     */
    private async persistExchange(question: string, answer: string): Promise<void> {
        if (this.persistDisabled) return;
        try {
            const db = getConversationDB();
            if (!this.convSessionId) {
                const session = await db.createSession(
                    undefined,
                    question.substring(0, 30),
                    { source: CLI_SESSION_SOURCE, host: os.hostname() },
                );
                this.convSessionId = session.id;
            }
            await db.saveMessage(this.convSessionId, 'user', question, { model: this.client.model });
            await db.saveMessage(this.convSessionId, 'assistant', answer, { model: this.client.model });
            this.persisted = true;
        } catch (error) {
            this.persistDisabled = true;
            logger.info(chalk.gray(
                `⚠️  대화 기록 저장 비활성화 (DB 연결 실패): ${error instanceof Error ? error.message : error}`,
            ));
        }
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

export async function startChat(client: LLMClient, options?: ChatOptions): Promise<void> {
    const session = new ChatSession(client, options);
    await session.start();
}
