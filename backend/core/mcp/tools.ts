/**
 * ============================================================
 * MCP 내장 도구 (Built-in Tools)
 * ============================================================
 * 
 * LLM이 사용할 수 있는 기본 도구들을 정의합니다.
 * 
 * @module backend/core/mcp/tools
 * @description
 * - 파일 읽기/쓰기 (read_file, write_file)
 * - 명령어 실행 (run_command)
 * - 코드 검색 (search_code)
 * - 웹 검색 (from web-search.ts)
 * - GitHub 도구 (from github-tools.ts)
 * - Exa 검색 (from exa-search.ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MCPToolDefinition, MCPToolResult } from './types';

const execAsync = promisify(exec);

/**
 * 파일 읽기 도구
 * 지정된 경로의 파일 내용을 읽어 반환합니다.
 * 
 * @param args.path - 읽을 파일의 경로
 * @returns 파일 내용 텍스트
 */
export const readFileTool: MCPToolDefinition = {
    tool: {
        name: 'read_file',
        description: '파일의 내용을 읽습니다',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '읽을 파일의 경로'
                }
            },
            required: ['path']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const filePath = args.path as string;
            const absolutePath = path.resolve(filePath);
            const content = fs.readFileSync(absolutePath, 'utf-8');
            return {
                content: [{ type: 'text', text: content }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `파일 읽기 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 파일 쓰기 도구
 * 지정된 경로에 파일을 생성하거나 덮어씁니다.
 * 필요시 디렉토리를 자동 생성합니다.
 * 
 * @param args.path - 쓸 파일의 경로
 * @param args.content - 파일에 쓸 내용
 * @returns 저장 완료 메시지
 */
export const writeFileTool: MCPToolDefinition = {
    tool: {
        name: 'write_file',
        description: '파일에 내용을 씁니다',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '쓸 파일의 경로'
                },
                content: {
                    type: 'string',
                    description: '파일에 쓸 내용'
                }
            },
            required: ['path', 'content']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const filePath = args.path as string;
            const content = args.content as string;
            const absolutePath = path.resolve(filePath);

            // 디렉토리가 없으면 생성
            const dir = path.dirname(absolutePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(absolutePath, content);
            return {
                content: [{ type: 'text', text: `파일 저장됨: ${absolutePath}` }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `파일 쓰기 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 셸 명령어 실행 도구
 * 지정된 명령어를 셸에서 실행하고 결과를 반환합니다.
 * 
 * @param args.command - 실행할 셸 명령어
 * @param args.cwd - 작업 디렉토리 (선택사항)
 * @returns 명령어 실행 결과 (stdout + stderr)
 */
export const runCommandTool: MCPToolDefinition = {
    tool: {
        name: 'run_command',
        description: '셸 명령어를 실행합니다',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: '실행할 명령어'
                },
                cwd: {
                    type: 'string',
                    description: '작업 디렉토리 (선택)'
                }
            },
            required: ['command']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const command = args.command as string;
            const cwd = (args.cwd as string) || process.cwd();

            const { stdout, stderr } = await execAsync(command, { cwd });
            const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');

            return {
                content: [{ type: 'text', text: output || '명령 완료 (출력 없음)' }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `명령 실행 실패: ${error}` }],
                isError: true
            };
        }
    }
};

/**
 * 코드 검색 도구
 * 지정된 디렉토리에서 정규식 패턴과 일치하는 코드를 검색합니다.
 * node_modules 및 숨김 디렉토리는 제외됩니다.
 * 
 * @param args.pattern - 검색할 정규식 패턴
 * @param args.directory - 검색할 디렉토리
 * @param args.extensions - 검색할 파일 확장자 배열 (기본값: ['.ts', '.js', '.py', '.go'])
 * @returns 검색 결과 (파일:라인: 내용 형식)
 */
export const searchCodeTool: MCPToolDefinition = {
    tool: {
        name: 'search_code',
        description: '디렉토리에서 코드를 검색합니다',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: '검색할 패턴 (정규식)'
                },
                directory: {
                    type: 'string',
                    description: '검색할 디렉토리'
                },
                extensions: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '검색할 파일 확장자 (예: [".ts", ".js"])'
                }
            },
            required: ['pattern', 'directory']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            const pattern = args.pattern as string;
            const directory = args.directory as string;
            const extensions = (args.extensions as string[]) || ['.ts', '.js', '.py', '.go'];

            const results: string[] = [];
            const regex = new RegExp(pattern, 'gi');

            function searchDir(dir: string): void {
                const entries = fs.readdirSync(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);

                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        searchDir(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name);
                        if (extensions.includes(ext)) {
                            try {
                                const content = fs.readFileSync(fullPath, 'utf-8');
                                const lines = content.split('\n');

                                lines.forEach((line, index) => {
                                    if (regex.test(line)) {
                                        results.push(`${fullPath}:${index + 1}: ${line.trim()}`);
                                    }
                                });
                            } catch {
                                // 읽기 실패 무시
                            }
                        }
                    }
                }
            }

            searchDir(path.resolve(directory));

            return {
                content: [{
                    type: 'text',
                    text: results.length > 0
                        ? `검색 결과 (${results.length}개):\n${results.slice(0, 50).join('\n')}`
                        : '검색 결과 없음'
                }]
            };
        } catch (error) {
            return {
                content: [{ type: 'text', text: `검색 실패: ${error}` }],
                isError: true
            };
        }
    }
};

// 웹 검색 도구 가져오기
import { webSearchTools } from './web-search';
// GitHub 도구 가져오기
import { githubTools } from './github-tools';
// Exa 검색 도구 가져오기
import { exaTools } from './exa-search';

/**
 * 내장 MCP 도구 배열
 * 
 * 모든 기본 제공 도구를 포함합니다:
 * - read_file: 파일 읽기
 * - write_file: 파일 쓰기
 * - run_command: 명령어 실행
 * - search_code: 코드 검색
 * - 웹 검색 도구들 (web_search, fact_check 등)
 * - GitHub 도구들 (search_repos, get_repo 등)
 * - Exa 검색 도구들 (exa_search, exa_code_search 등)
 */
export const builtInTools: MCPToolDefinition[] = [
    readFileTool,
    writeFileTool,
    runCommandTool,
    searchCodeTool,
    ...webSearchTools,
    ...githubTools,
    ...exaTools
];
