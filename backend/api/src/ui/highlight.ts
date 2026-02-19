/**
 * ============================================================
 * CLI Highlight UI - 코드 하이라이트/포맷팅 유틸
 * ============================================================
 * 코드 블록 하이라이트, 라인 번호 렌더링, 파일 확장자 기반
 * 언어 감지를 담당합니다.
 *
 * @module ui/highlight
 */

import { highlight } from 'cli-highlight';
import chalk from 'chalk';

export function highlightCode(code: string, language?: string): string {
    try {
        return highlight(code, {
            language: language || 'auto'
        });
    } catch {
        return code;
    }
}

export function formatCodeBlock(code: string, language?: string): string {
    const highlighted = highlightCode(code.trim(), language);
    const lines = highlighted.split('\n');
    const numberedLines = lines.map((line, i) => {
        const lineNum = chalk.gray.dim(`${String(i + 1).padStart(3)} | `);
        return lineNum + line;
    });

    const header = chalk.gray.dim('-'.repeat(60));
    const langLabel = language ? chalk.cyan.bold(` ${language.toUpperCase()} `) : '';

    return `\n${langLabel}${header}\n${numberedLines.join('\n')}\n${header}\n`;
}

export function detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        rb: 'ruby',
        go: 'go',
        rs: 'rust',
        java: 'java',
        cpp: 'cpp',
        c: 'c',
        cs: 'csharp',
        php: 'php',
        html: 'html',
        css: 'css',
        scss: 'scss',
        json: 'json',
        yaml: 'yaml',
        yml: 'yaml',
        md: 'markdown',
        sql: 'sql',
        sh: 'bash',
        bash: 'bash',
        zsh: 'bash'
    };
    return langMap[ext || ''] || 'plaintext';
}
