/**
 * ============================================================
 * Filesystem - 샌드박스 기반 파일시스템 MCP 도구
 * ============================================================
 *
 * 사용자별 격리된 파일시스템 접근을 제공하는 MCP 도구 모듈입니다.
 * UserSandbox를 통해 사용자 디렉토리 외부 접근을 차단합니다.
 *
 * @module mcp/filesystem
 * @description
 * - fs_read_file: 사용자 샌드박스 내 파일 읽기
 * - fs_write_file: 사용자 샌드박스 내 파일 쓰기 (확장자 검증)
 * - fs_list_directory: 사용자 샌드박스 내 디렉토리 목록 조회
 * - fs_delete_file: 사용자 샌드박스 내 파일 삭제
 *
 * @security
 * - UserSandbox.validatePath()로 경로 탐색(LFI) 공격 방지
 * - 허용된 파일 확장자만 쓰기 가능 (ALLOWED_EXTENSIONS)
 * - 금지된 패턴(.env, .ssh, credentials 등) 접근 차단
 * - 모든 도구는 UserContext 필수 (사용자 인증 확인)
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { UserSandbox, UserContext } from './user-sandbox';
import { MCPToolDefinition, MCPToolResult, MCPToolHandler } from './types';

/**
 * 허용된 파일 확장자 집합
 *
 * fs_write_file에서 쓰기 가능한 확장자를 제한합니다.
 * 실행 파일(.exe, .bat 등)이나 시스템 파일은 포함되지 않습니다.
 */
const ALLOWED_EXTENSIONS = new Set([
    '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
    '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
    '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h',
    '.sh', '.bash', '.zsh', '.fish',
    '.csv', '.log', '.env.example'
]);

/**
 * 금지된 파일 경로 패턴
 *
 * 보안상 접근을 차단해야 하는 경로 패턴입니다.
 * node_modules, .git, .env, .ssh, 비밀번호/인증 관련 파일 등을 포함합니다.
 */
const FORBIDDEN_PATTERNS = [
    /node_modules/,
    /\.git\//,
    /\.env$/,
    /\.ssh/,
    /\.gnupg/,
    /password/i,
    /secret/i,
    /credentials/i
];

/**
 * 파일 경로 검증
 *
 * UserSandbox.resolvePath()로 경로를 안전한 절대 경로로 변환한 후,
 * 금지된 패턴과의 매칭을 검사합니다.
 *
 * @param userId - 사용자 ID (샌드박스 루트 결정)
 * @param filePath - 검증할 파일 경로 (상대/절대)
 * @returns 검증 결과 (valid, resolvedPath, error)
 */
export function validateFilePath(userId: string | number, filePath: string): {
    valid: boolean;
    resolvedPath: string | null;
    error?: string;
} {
    // 1. 경로 탈출 검사
    const resolved = UserSandbox.resolvePath(userId, filePath);
    if (!resolved) {
        return {
            valid: false,
            resolvedPath: null,
            error: '접근 권한이 없는 경로입니다'
        };
    }

    // 2. 금지 패턴 검사
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(resolved)) {
            return {
                valid: false,
                resolvedPath: null,
                error: '접근이 금지된 경로입니다'
            };
        }
    }

    return {
        valid: true,
        resolvedPath: resolved
    };
}

/**
 * 파일 확장자가 허용 목록에 포함되는지 검증
 *
 * 확장자가 없는 파일(예: Makefile)도 허용합니다.
 *
 * @param filePath - 확인할 파일 경로
 * @returns 허용된 확장자이면 true
 */
export function isAllowedExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext) || ext === '';
}

/**
 * 디렉토리 존재 여부를 비동기로 확인
 *
 * @param dirPath - 확인할 디렉토리 경로
 * @returns 존재하면 true
 */
async function directoryExists(dirPath: string): Promise<boolean> {
    try {
        await fs.access(dirPath);
        return true;
    } catch {
        return false;
    }
}

// ============================================
// Filesystem MCP 도구 정의
// ============================================

/**
 * 파일 읽기 도구 (fs_read_file)
 *
 * 사용자 샌드박스 내에서 파일 내용을 읽어 반환합니다.
 * UserContext 필수 - 미인증 요청은 거부됩니다.
 *
 * @param args.path - 읽을 파일 경로 (상대 경로 권장)
 * @param args.encoding - 파일 인코딩 (기본값: 'utf-8')
 * @returns 파일 내용 또는 에러 메시지
 */
export const readFileTool: MCPToolDefinition = {
    tool: {
        name: 'fs_read_file',
        description: '파일 내용을 읽습니다. 사용자 작업 디렉토리 내에서만 접근 가능합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '읽을 파일 경로 (상대 경로 권장)'
                },
                encoding: {
                    type: 'string',
                    description: '인코딩 (기본: utf-8)',
                    default: 'utf-8'
                }
            },
            required: ['path']
        }
    },
    handler: (async (params: { path: string; encoding?: string }, context?: UserContext): Promise<MCPToolResult> => {
        if (!context) {
            return {
                content: [{ type: 'text', text: '사용자 컨텍스트가 필요합니다' }],
                isError: true
            };
        }

        const validation = validateFilePath(context.userId, params.path);
        if (!validation.valid) {
            return {
                content: [{ type: 'text', text: validation.error || '경로 검증 실패' }],
                isError: true
            };
        }

        try {
            const encoding = (params.encoding || 'utf-8') as BufferEncoding;
            const content = await fs.readFile(validation.resolvedPath!, { encoding });
            return {
                content: [{ type: 'text', text: content }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `파일 읽기 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }) as MCPToolHandler
};

/**
 * 파일 쓰기 도구 (fs_write_file)
 *
 * 사용자 샌드박스 내에 파일을 생성/수정합니다.
 * 허용된 확장자만 쓰기 가능하며, 디렉토리가 없으면 자동 생성합니다.
 *
 * @param args.path - 쓸 파일 경로 (상대 경로 권장)
 * @param args.content - 파일에 쓸 내용
 * @param args.encoding - 파일 인코딩 (기본값: 'utf-8')
 * @returns 성공/실패 메시지
 */
export const writeFileTool: MCPToolDefinition = {
    tool: {
        name: 'fs_write_file',
        description: '파일에 내용을 씁니다. 사용자 작업 디렉토리 내에서만 접근 가능합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '쓸 파일 경로 (상대 경로 권장)'
                },
                content: {
                    type: 'string',
                    description: '파일 내용'
                },
                encoding: {
                    type: 'string',
                    description: '인코딩 (기본: utf-8)',
                    default: 'utf-8'
                }
            },
            required: ['path', 'content']
        }
    },
    handler: (async (params: { path: string; content: string; encoding?: string }, context?: UserContext): Promise<MCPToolResult> => {
        if (!context) {
            return {
                content: [{ type: 'text', text: '사용자 컨텍스트가 필요합니다' }],
                isError: true
            };
        }

        const validation = validateFilePath(context.userId, params.path);
        if (!validation.valid) {
            return {
                content: [{ type: 'text', text: validation.error || '경로 검증 실패' }],
                isError: true
            };
        }

        // 확장자 검사
        if (!isAllowedExtension(params.path)) {
            return {
                content: [{ type: 'text', text: '허용되지 않은 파일 확장자입니다' }],
                isError: true
            };
        }

        try {
            // 디렉토리 생성 (비동기)
            const dir = path.dirname(validation.resolvedPath!);
            if (!(await directoryExists(dir))) {
                await fs.mkdir(dir, { recursive: true });
            }

            const encoding = (params.encoding || 'utf-8') as BufferEncoding;
            await fs.writeFile(validation.resolvedPath!, params.content, { encoding });
            return {
                content: [{ type: 'text', text: `파일 저장 완료: ${params.path}` }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `파일 쓰기 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }) as MCPToolHandler
};

/**
 * 디렉토리 목록 도구 (fs_list_directory)
 *
 * 사용자 샌드박스 내 디렉토리의 항목(파일/하위 디렉토리)을 나열합니다.
 * 각 항목의 이름, 타입, 파일 크기를 JSON으로 반환합니다.
 *
 * @param args.path - 조회할 디렉토리 경로 (기본값: 작업 디렉토리)
 * @returns 디렉토리 항목 JSON 배열 또는 에러 메시지
 */
export const listDirectoryTool: MCPToolDefinition = {
    tool: {
        name: 'fs_list_directory',
        description: '디렉토리 내용을 나열합니다. 사용자 작업 디렉토리 내에서만 접근 가능합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '조회할 디렉토리 경로 (기본: 작업 디렉토리)'
                }
            }
        }
    },
    handler: (async (params: { path?: string }, context?: UserContext): Promise<MCPToolResult> => {
        if (!context) {
            return {
                content: [{ type: 'text', text: '사용자 컨텍스트가 필요합니다' }],
                isError: true
            };
        }

        const targetPath = params.path || '.';
        const validation = validateFilePath(context.userId, targetPath);
        if (!validation.valid) {
            return {
                content: [{ type: 'text', text: validation.error || '경로 검증 실패' }],
                isError: true
            };
        }

        try {
            const items = await fs.readdir(validation.resolvedPath!, { withFileTypes: true });
            const result = await Promise.all(items.map(async item => {
                const itemPath = path.join(validation.resolvedPath!, item.name);
                let size: number | undefined;
                if (item.isFile()) {
                    const stat = await fs.stat(itemPath);
                    size = stat.size;
                }
                return {
                    name: item.name,
                    type: item.isDirectory() ? 'directory' : 'file',
                    size
                };
            }));

            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `디렉토리 조회 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }) as MCPToolHandler
};

/**
 * 파일 삭제 도구 (fs_delete_file)
 *
 * 사용자 샌드박스 내에서 파일을 삭제합니다.
 * 디렉토리 삭제는 지원하지 않습니다 (fs.unlink 사용).
 *
 * @param args.path - 삭제할 파일 경로
 * @returns 성공/실패 메시지
 */
export const deleteFileTool: MCPToolDefinition = {
    tool: {
        name: 'fs_delete_file',
        description: '파일을 삭제합니다. 사용자 작업 디렉토리 내에서만 접근 가능합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '삭제할 파일 경로'
                }
            },
            required: ['path']
        }
    },
    handler: (async (params: { path: string }, context?: UserContext): Promise<MCPToolResult> => {
        if (!context) {
            return {
                content: [{ type: 'text', text: '사용자 컨텍스트가 필요합니다' }],
                isError: true
            };
        }

        const validation = validateFilePath(context.userId, params.path);
        if (!validation.valid) {
            return {
                content: [{ type: 'text', text: validation.error || '경로 검증 실패' }],
                isError: true
            };
        }

        try {
            await fs.unlink(validation.resolvedPath!);
            return {
                content: [{ type: 'text', text: `파일 삭제 완료: ${params.path}` }],
                isError: false
            };
        } catch (error: unknown) {
            return {
                content: [{ type: 'text', text: `파일 삭제 실패: ${(error instanceof Error ? error.message : String(error))}` }],
                isError: true
            };
        }
    }) as MCPToolHandler
};

// ============================================
// 도구 목록 내보내기
// ============================================

/**
 * 파일시스템 MCP 도구 배열
 *
 * 모든 파일시스템 도구를 하나의 배열로 내보냅니다.
 * builtInTools에 스프레드 연산자로 추가하여 사용합니다.
 */
export const filesystemTools: MCPToolDefinition[] = [
    readFileTool,
    writeFileTool,
    listDirectoryTool,
    deleteFileTool
];
