/**
 * Terminal Tools MCP Module
 * 안전한 터미널 명령어 실행 기능을 제공합니다.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

// 허용된 명령어 화이트리스트
const ALLOWED_COMMANDS = new Set([
    // 기본 유틸리티
    'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'which',
    // 파일 정보
    'file', 'stat', 'du', 'df',
    // 텍스트 처리
    'sort', 'uniq', 'cut', 'tr', 'sed', 'awk',
    // 네트워크 (읽기 전용)
    'ping', 'curl', 'wget', 'dig', 'nslookup',
    // 개발 도구
    'node', 'npm', 'npx', 'git', 'python', 'python3', 'pip',
    // 시스템 정보
    'uname', 'date', 'uptime', 'whoami', 'env'
]);

// 위험한 패턴 (절대 허용 안 함)
const DANGEROUS_PATTERNS = [
    /rm\s+-rf/i,
    /sudo/i,
    /chmod\s+777/i,
    />\s*\/dev/i,
    /mkfs/i,
    /dd\s+if=/i,
    /:(){ :|:& };:/,  // Fork bomb
    /\|\s*sh/i,
    /eval\s*\(/i,
    /exec\s*\(/i
];

// 실행 결과 인터페이스
export interface ExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    duration: number;
    command: string;
    error?: string;
}

// 옵션 인터페이스
export interface ExecutionOptions {
    cwd?: string;
    timeout?: number;  // ms
    maxOutputSize?: number;  // bytes
    env?: Record<string, string>;
}

/**
 * 명령어 검증
 */
function validateCommand(command: string): { valid: boolean; reason?: string } {
    // 빈 명령어
    if (!command || !command.trim()) {
        return { valid: false, reason: '빈 명령어입니다.' };
    }

    // 위험한 패턴 검사
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
            return { valid: false, reason: '위험한 명령어 패턴이 감지되었습니다.' };
        }
    }

    // 첫 번째 명령어 추출
    const parts = command.trim().split(/\s+/);
    const baseCommand = path.basename(parts[0]);

    // 화이트리스트 검사
    if (!ALLOWED_COMMANDS.has(baseCommand)) {
        return {
            valid: false,
            reason: `'${baseCommand}'는 허용되지 않은 명령어입니다. 허용된 명령어: ${Array.from(ALLOWED_COMMANDS).join(', ')}`
        };
    }

    return { valid: true };
}

/**
 * 안전한 명령어 실행
 */
export async function executeCommand(
    command: string,
    options: ExecutionOptions = {}
): Promise<ExecutionResult> {
    const startTime = Date.now();
    const {
        cwd = process.cwd(),
        timeout = 30000,
        maxOutputSize = 1024 * 1024,  // 1MB
        env = {}
    } = options;

    // 명령어 검증
    const validation = validateCommand(command);
    if (!validation.valid) {
        return {
            success: false,
            stdout: '',
            stderr: validation.reason || '명령어 검증 실패',
            exitCode: null,
            duration: Date.now() - startTime,
            command,
            error: validation.reason
        };
    }

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        // 쉘에서 실행
        const child: ChildProcess = spawn('sh', ['-c', command], {
            cwd,
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // 타임아웃
        const timer = setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }, 1000);
        }, timeout);

        // stdout 수집
        child.stdout?.on('data', (data: Buffer) => {
            if (stdout.length < maxOutputSize) {
                stdout += data.toString();
            }
        });

        // stderr 수집
        child.stderr?.on('data', (data: Buffer) => {
            if (stderr.length < maxOutputSize) {
                stderr += data.toString();
            }
        });

        // 완료
        child.on('close', (code) => {
            clearTimeout(timer);

            resolve({
                success: code === 0 && !killed,
                stdout: stdout.slice(0, maxOutputSize),
                stderr: stderr.slice(0, maxOutputSize),
                exitCode: code,
                duration: Date.now() - startTime,
                command,
                error: killed ? '실행 시간 초과' : undefined
            });
        });

        // 에러
        child.on('error', (err) => {
            clearTimeout(timer);

            resolve({
                success: false,
                stdout,
                stderr: err.message,
                exitCode: null,
                duration: Date.now() - startTime,
                command,
                error: err.message
            });
        });
    });
}

/**
 * 허용된 명령어 목록 조회
 */
export function getAllowedCommands(): string[] {
    return Array.from(ALLOWED_COMMANDS).sort();
}

/**
 * 명령어 도움말
 */
export function getCommandHelp(): string {
    return `
터미널 도구 사용법
==================

이 도구를 사용하면 안전한 터미널 명령어를 실행할 수 있습니다.

허용된 명령어:
${Array.from(ALLOWED_COMMANDS).sort().join(', ')}

예시:
- ls -la              # 현재 디렉토리 파일 목록
- pwd                 # 현재 작업 디렉토리
- git status          # Git 상태 확인
- npm list            # 설치된 패키지 목록
- cat package.json    # 파일 내용 보기

제한 사항:
- 타임아웃: 30초
- 최대 출력: 1MB
- 일부 위험한 명령어는 차단됩니다.
`;
}

/**
 * MCP 도구 정의
 */
export const terminalTool = {
    name: 'terminal_execute',
    description: '안전한 터미널 명령어를 실행합니다. 허용된 명령어만 사용 가능합니다.',
    inputSchema: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: '실행할 명령어'
            },
            cwd: {
                type: 'string',
                description: '작업 디렉토리 (선택사항)'
            }
        },
        required: ['command']
    },
    async execute(params: { command: string; cwd?: string }): Promise<ExecutionResult> {
        return executeCommand(params.command, { cwd: params.cwd });
    }
};
