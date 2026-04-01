<<<<<<< HEAD
/**
 * ============================================================
 * Generate Command - 코드 생성 CLI 명령
 * ============================================================
 *
 * 자연어 설명을 기반으로 LLM이 코드를 생성하는 CLI 명령입니다.
 * 스트리밍 출력을 지원하며, 생성된 코드를 파일로 저장할 수 있습니다.
 *
 * @module commands/generate
 * @example
 * node cli.js generate "Express REST API with TypeScript" -l typescript
 * node cli.js generate "sorting algorithm" -o sort.py -l python
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { OllamaClient } from '../ollama/client';
import { getSystemPrompt } from '../domains/chat/pipeline/prompt';
import { createSpinner } from '../ui/spinner';

/**
 * 자연어 설명으로 코드를 생성합니다.
 * 스트리밍으로 토큰을 출력하고, 파일 저장 옵션을 제공합니다.
 * @param client - Ollama 클라이언트 인스턴스
 * @param description - 코드 생성 요구사항 설명
 * @param options - 생성 옵션 (output: 저장 파일명, language: 프로그래밍 언어)
 */
export async function generateCode(
=======
/**
 * ============================================================
 * Generate Command - 코드 생성 CLI 명령
 * ============================================================
 *
 * 자연어 설명을 기반으로 LLM이 코드를 생성하는 CLI 명령입니다.
 * 스트리밍 출력을 지원하며, 생성된 코드를 파일로 저장할 수 있습니다.
 *
 * @module commands/generate
 * @example
 * node cli.js generate "Express REST API with TypeScript" -l typescript
 * node cli.js generate "sorting algorithm" -o sort.py -l python
 */
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { OllamaClient } from '../ollama/client';
import { getSystemPrompt } from '../chat/prompt';
import { LLM_TEMPERATURES } from '../config/llm-parameters';
import { createSpinner } from '../ui/spinner';

/**
 * 자연어 설명으로 코드를 생성합니다.
 * 스트리밍으로 토큰을 출력하고, 파일 저장 옵션을 제공합니다.
 * @param client - Ollama 클라이언트 인스턴스
 * @param description - 코드 생성 요구사항 설명
 * @param options - 생성 옵션 (output: 저장 파일명, language: 프로그래밍 언어)
 */
export async function generateCode(
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
    client: OllamaClient,
    description: string,
    options: { output?: string; language?: string } = {}
): Promise<void> {
    console.log(chalk.cyan('\n🚀 코드 생성'));
    console.log(chalk.gray(`   설명: ${description}`));
    if (options.language) {
        console.log(chalk.gray(`   언어: ${options.language}`));
    }
    console.log('');

    const languageHint = options.language ? `${options.language} 언어로 ` : '';
    const prompt = `다음 요구사항에 맞는 ${languageHint}코드를 생성해주세요:

${description}

요구사항:
1. 깔끔하고 읽기 쉬운 코드 작성
2. 적절한 주석 포함
3. 에러 처리 포함
4. 코드 블록으로 감싸서 제공`;

    const spinner = createSpinner('코드 생성 중...');
    spinner.start();

    let generatedCode = '';

    try {
        let firstToken = true;

        await client.chat(
            [
                { role: 'system', content: getSystemPrompt('generator') },
                { role: 'user', content: prompt }
            ],
            { temperature: LLM_TEMPERATURES.CLI_GENERATE },
            (token) => {
                if (firstToken) {
                    spinner.stop();
                    console.log(chalk.cyan('💻 생성된 코드:\n'));
                    firstToken = false;
                }
                process.stdout.write(token);
                generatedCode += token;
            }
        );

        console.log('\n');

        // 파일 저장 옵션
        if (options.output) {
            await saveToFile(generatedCode, options.output);
        } else {
            const { save } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'save',
                    message: '코드를 파일로 저장할까요?',
                    default: false
                }
            ]);

            if (save) {
                const { filename } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'filename',
                        message: '파일명을 입력하세요:',
                        default: 'generated_code.txt'
                    }
                ]);
                await saveToFile(generatedCode, filename);
            }
        }
    } catch (error) {
        spinner.fail('코드 생성 실패');
        if (error instanceof Error) {
            console.log(chalk.red(`\n❌ 오류: ${error.message}\n`));
        }
    }
}

/**
 * 생성된 코드를 파일로 저장합니다.
 * 마크다운 코드 블록 내의 코드만 추출하여 저장합니다.
 * @param content - 생성된 코드 (마크다운 코드 블록 포함 가능)
 * @param filename - 저장할 파일명
 */
async function saveToFile(content: string, filename: string): Promise<void> {
    try {
        // 코드 블록에서 코드만 추출
        const codeMatch = content.match(/```[\w]*\n([\s\S]*?)```/);
        const codeToSave = codeMatch ? codeMatch[1] : content;

        const absolutePath = path.resolve(filename);
        fs.writeFileSync(absolutePath, codeToSave.trim());
        console.log(chalk.green(`\n✅ 파일 저장됨: ${absolutePath}\n`));
    } catch (error) {
        console.log(chalk.red(`\n❌ 파일 저장 실패\n`));
    }
}
