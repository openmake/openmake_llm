import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { OllamaClient } from '../ollama/client';
import { getSystemPrompt } from '../chat/prompt';
import { createSpinner } from '../ui/spinner';

export async function generateCode(
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

        const response = await client.chat(
            [
                { role: 'system', content: getSystemPrompt('generator') },
                { role: 'user', content: prompt }
            ],
            { temperature: 0.5 },
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
