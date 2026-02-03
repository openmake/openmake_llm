/**
 * Filesystem MCP Server 통합
 * 
 * @modelcontextprotocol/server-filesystem 기반
 * 사용자별 격리된 파일시스템 접근 제공
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { UserSandbox, UserContext } from './user-sandbox';
import { MCPToolDefinition, MCPToolResult, MCPToolHandler } from './types';

// 허용된 파일 확장자
const ALLOWED_EXTENSIONS = new Set([
    '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
    '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
    '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h',
    '.sh', '.bash', '.zsh', '.fish',
    '.csv', '.log', '.env.example'
]);

// 금지된 파일 패턴
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
 * 파일 확장자 검증
 */
export function isAllowedExtension(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext) || ext === '';
}

/**
 * 디렉토리 존재 여부 확인 (비동기)
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
 * 파일 읽기 도구
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
 * 파일 쓰기 도구
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
 * 디렉토리 목록 도구
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
 * 파일 삭제 도구
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

export const filesystemTools: MCPToolDefinition[] = [
    readFileTool,
    writeFileTool,
    listDirectoryTool,
    deleteFileTool
];
