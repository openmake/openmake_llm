/**
 * ============================================================
 * Explain Command - 코드 설명 CLI 명령
 * ============================================================
 *
 * 지정된 파일의 코드를 LLM에 전달하여 상세 설명을 생성합니다.
 * 전체 목적, 주요 함수/클래스 설명, 핵심 로직 분석, 패턴 분석을 포함합니다.
 *
 * @module commands/explain
 * @example
 * node cli.js explain ./src/utils.ts
 * node cli.js explain ./services/ChatService.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { OllamaClient } from '../ollama/client';
import { getSystemPrompt } from '../chat/prompt';
import { LLM_TEMPERATURES } from '../config/llm-parameters';
import { createSpinner } from '../ui/spinner';
import { detectLanguage } from '../ui/highlight';

/**
 * 파일의 코드를 LLM으로 분석하여 상세 설명을 생성합니다.
 * 전체 목적, 주요 함수/클래스, 핵심 로직, 사용 패턴을 스트리밍 출력합니다.
 * @param client - Ollama 클라이언트 인스턴스
 * @param filePath - 설명할 파일 경로
 */
export async function explainFile(client: OllamaClient, filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
        console.log(chalk.red(`\n❌ 파일을 찾을 수 없습니다: ${filePath}\n`));
        return;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const language = detectLanguage(absolutePath);
    const fileName = path.basename(absolutePath);

    console.log(chalk.cyan(`\n📖 코드 설명: `) + chalk.white.bold(fileName));
    console.log(chalk.gray(`   경로: ${absolutePath}`));
    console.log(chalk.gray(`   언어: ${language}\n`));

    const prompt = `다음 ${language} 코드를 상세히 설명해주세요:

파일: ${fileName}

\`\`\`${language}
${content}
\`\`\`

다음 내용을 포함해주세요:
1. 코드의 전체 목적
2. 주요 함수/클래스 설명
3. 핵심 로직 분석
4. 사용된 패턴이나 기법`;

    const spinner = createSpinner('코드 분석 중...');
    spinner.start();

    try {
        let firstToken = true;

        await client.chat(
            [
                { role: 'system', content: getSystemPrompt('explainer') },
                { role: 'user', content: prompt }
            ],
            { temperature: LLM_TEMPERATURES.CLI_EXPLAIN },
            (token) => {
                if (firstToken) {
                    spinner.stop();
                    console.log(chalk.cyan('💡 코드 설명:\n'));
                    firstToken = false;
                }
                process.stdout.write(token);
            }
        );

        console.log('\n');
    } catch (error) {
        spinner.fail('설명 생성 실패');
        if (error instanceof Error) {
            console.log(chalk.red(`\n❌ 오류: ${error.message}\n`));
        }
    }
}
