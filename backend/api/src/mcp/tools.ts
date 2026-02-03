import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MCPToolDefinition, MCPToolResult } from './types';

const execAsync = promisify(exec);

// 파일 읽기 도구
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

// 파일 쓰기 도구
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

// 명령어 실행 도구
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

// 코드 검색 도구
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

// ============================================
// Vision Tools (OCR / Image Analysis)
// ============================================

/**
 * 이미지 OCR 도구 - 이미지에서 텍스트 추출
 */
export const visionOcrTool: MCPToolDefinition = {
    tool: {
        name: 'vision_ocr',
        description: '이미지에서 텍스트를 추출합니다 (OCR). 문서, 스크린샷, 사진 등에서 텍스트를 읽어옵니다.',
        inputSchema: {
            type: 'object',
            properties: {
                image_path: {
                    type: 'string',
                    description: '이미지 파일 경로 (절대 경로 또는 상대 경로)'
                },
                image_base64: {
                    type: 'string',
                    description: 'Base64 인코딩된 이미지 데이터 (image_path 대신 사용 가능)'
                },
                language: {
                    type: 'string',
                    description: '추출할 텍스트 언어 (예: ko, en, ja). 기본값: 자동 감지'
                }
            },
            required: []
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        // 실제 OCR은 ChatService에서 비전 모델을 통해 처리됨
        // 이 핸들러는 MCP 도구 형식 호환용으로만 사용
        return {
            content: [{
                type: 'text',
                text: 'OCR은 비전 모델을 통해 ChatService에서 직접 처리됩니다. image_path 또는 image_base64를 전달하세요.'
            }]
        };
    }
};

/**
 * 이미지 분석 도구 - 이미지 내용 분석 및 설명
 */
export const analyzeImageTool: MCPToolDefinition = {
    tool: {
        name: 'analyze_image',
        description: '이미지의 내용을 분석하고 설명합니다. 사진, 다이어그램, 차트 등을 분석합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                image_path: {
                    type: 'string',
                    description: '분석할 이미지 파일 경로'
                },
                image_base64: {
                    type: 'string',
                    description: 'Base64 인코딩된 이미지 데이터'
                },
                question: {
                    type: 'string',
                    description: '이미지에 대해 묻고 싶은 질문 (선택)'
                }
            },
            required: []
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        return {
            content: [{
                type: 'text',
                text: '이미지 분석은 비전 모델을 통해 ChatService에서 직접 처리됩니다.'
            }]
        };
    }
};

// 웹 검색 도구 가져오기
import { webSearchTools } from './web-search';
// Firecrawl MCP 도구 가져오기
import { firecrawlTools, isFirecrawlConfigured } from './firecrawl';

// 모든 도구 내보내기 (Firecrawl은 API 키가 설정된 경우에만 추가)
export const builtInTools: MCPToolDefinition[] = [
    runCommandTool,
    visionOcrTool,
    analyzeImageTool,
    ...webSearchTools,
    ...(isFirecrawlConfigured() ? firecrawlTools : []),
];
