import ora, { Ora } from 'ora';
import chalk from 'chalk';

export class Spinner {
    private spinner: Ora;

    constructor(text: string = '처리 중...') {
        this.spinner = ora({
            text,
            spinner: 'dots',
            color: 'cyan'
        });
    }

    start(text?: string): void {
        if (text) this.spinner.text = text;
        this.spinner.start();
    }

    stop(): void {
        this.spinner.stop();
    }

    succeed(text?: string): void {
        this.spinner.succeed(text || '완료');
    }

    fail(text?: string): void {
        this.spinner.fail(text || '실패');
    }

    info(text: string): void {
        this.spinner.info(text);
    }

    warn(text: string): void {
        this.spinner.warn(text);
    }

    update(text: string): void {
        this.spinner.text = text;
    }
}

export function createSpinner(text?: string): Spinner {
    return new Spinner(text);
}

export function showTyping(): void {
    process.stdout.write(chalk.gray.dim('▌'));
}

export function clearTyping(): void {
    process.stdout.write('\r\x1b[K');
}
