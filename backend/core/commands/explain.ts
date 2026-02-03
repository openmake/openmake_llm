import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { OllamaClient } from '../ollama/client';
import { getSystemPrompt } from '../chat/prompt';
import { createSpinner } from '../ui/spinner';
import { formatCodeBlock, detectLanguage } from '../ui/highlight';

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
            { temperature: 0.3 },
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
