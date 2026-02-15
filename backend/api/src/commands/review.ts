/**
 * ============================================================
 * Review Command - 코드 리뷰 CLI 명령
 * ============================================================
 *
 * 지정된 파일의 코드를 LLM에 전달하여 코드 리뷰를 수행합니다.
 * 코드 품질 점수, 문제점, 개선 제안, 장점을 포함한 결과를 출력합니다.
 *
 * @module commands/review
 * @example
 * node cli.js review ./src/app.ts
 * node cli.js review ./utils/helper.py
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { OllamaClient } from '../ollama/client';
import { getSystemPrompt } from '../chat/prompt';
import { createSpinner } from '../ui/spinner';
import { formatCodeBlock, detectLanguage } from '../ui/highlight';

/**
 * 파일의 코드를 LLM으로 리뷰합니다.
 * 코드 품질(1-10점), 문제점, 개선 제안, 장점을 스트리밍 출력합니다.
 * @param client - Ollama 클라이언트 인스턴스
 * @param filePath - 리뷰할 파일 경로
 */
export async function reviewFile(client: OllamaClient, filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
        console.log(chalk.red(`\n❌ 파일을 찾을 수 없습니다: ${filePath}\n`));
        return;
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const language = detectLanguage(absolutePath);
    const fileName = path.basename(absolutePath);

    console.log(chalk.cyan(`\n📝 파일 리뷰: `) + chalk.white.bold(fileName));
    console.log(chalk.gray(`   경로: ${absolutePath}`));
    console.log(chalk.gray(`   언어: ${language}\n`));

    const prompt = `다음 ${language} 코드를 리뷰해주세요:

파일: ${fileName}

\`\`\`${language}
${content}
\`\`\`

다음 항목을 포함하여 리뷰해주세요:
1. 코드 품질 평가 (1-10점)
2. 발견된 문제점
3. 개선 제안
4. 좋은 점`;

    const spinner = createSpinner('코드 분석 중...');
    spinner.start();

    try {
        let firstToken = true;

        await client.chat(
            [
                { role: 'system', content: getSystemPrompt('reviewer') },
                { role: 'user', content: prompt }
            ],
            { temperature: 0.3 },
            (token) => {
                if (firstToken) {
                    spinner.stop();
                    console.log(chalk.cyan('🔍 리뷰 결과:\n'));
                    firstToken = false;
                }
                process.stdout.write(token);
            }
        );

        console.log('\n');
    } catch (error) {
        spinner.fail('리뷰 실패');
        if (error instanceof Error) {
            console.log(chalk.red(`\n❌ 오류: ${error.message}\n`));
        }
    }
}
