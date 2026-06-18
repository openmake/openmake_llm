/**
 * ============================================================
 * CLI Highlight UI - 코드 하이라이트/포맷팅 유틸
 * ============================================================
 * 코드 블록 하이라이트, 라인 번호 렌더링, 파일 확장자 기반
 * 언어 감지를 담당합니다.
 *
 * @module ui/highlight
 */

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
