/**
 * ============================================================
 * MCP Tools - 내장 MCP 도구 정의
 * ============================================================
 *
 * MCP 시스템에서 제공하는 내장(built-in) 도구들을 정의합니다.
 * 코드 검색, 이미지 OCR/분석, 웹 검색, Firecrawl 등의 도구를 포함합니다.
 *
 * @module mcp/tools
 * @description
 * - search_code: 프로젝트 디렉토리 내 코드 검색 (정규식 기반)
 * - vision_ocr / analyze_image: 비전 모델 기반 이미지 처리 (ChatService 위임)
 * - 웹 검색 도구 (web-search.ts에서 가져오기)
 * - Firecrawl 도구 (firecrawl.ts에서 조건부 가져오기)
 *
 * @security
 * - 2026-02-07 보안 패치: run_command(RCE), read_file/write_file(샌드박스 미적용) 제거
 * - search_code: 프로젝트 루트 외부 경로 접근 차단 (LFI 방지)
 * - 심볼릭 링크를 통한 디렉토리 탈출 방지
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MCPToolDefinition, MCPToolResult } from './types';
import { UserSandbox } from './user-sandbox';
import { CAPACITY } from '../config/runtime-limits';

// ============================================
// 🔒 보안 패치 2026-02-07:
// - read_file/write_file: 샌드박스 미적용 레거시 도구 제거
//   → mcp/filesystem.ts의 fs_read_file/fs_write_file (UserSandbox 적용) 사용
// ============================================

/**
 * 코드 검색 도구
 *
 * 지정된 디렉토리에서 정규식 패턴을 사용하여 코드를 검색합니다.
 * 프로젝트 루트(UserSandbox 작업 디렉토리) 외부 경로 접근을 차단하며,
 * 심볼릭 링크를 통한 탈출도 방지합니다.
 *
 * @param args.pattern - 검색할 정규식 패턴
 * @param args.directory - 검색 대상 디렉토리 경로
 * @param args.extensions - 검색할 파일 확장자 배열 (기본값: ['.ts', '.js', '.py', '.go'])
 * @returns 매칭된 파일:줄번호:내용 형식의 결과 (최대 50건)
 *
 * @security 프로젝트 루트 외부 접근 차단, 심볼릭 링크 탈출 방지, 최대 1000개 파일 스캔 제한
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
    handler: async (args, context): Promise<MCPToolResult> => {
        try {
            const pattern = args.pattern as string;
            const directory = args.directory as string;
            const extensions = (args.extensions as string[]) || ['.ts', '.js', '.py', '.go'];

            // 🔒 Phase 3 보안 패치: 경로 탐색(LFI) 방지
            // 허용된 기본 디렉토리(프로젝트 루트) 외부로의 접근을 차단
            const userId = context?.userId;
            const projectRoot = userId !== undefined
                ? path.resolve(UserSandbox.getWorkDir(userId))
                : path.resolve(os.tmpdir());
            const resolvedDir = path.resolve(directory);

            if (!resolvedDir.startsWith(projectRoot)) {
                return {
                    content: [{
                        type: 'text',
                        text: `보안 오류: 프로젝트 디렉토리(${projectRoot}) 외부 경로에는 접근할 수 없습니다.`
                    }],
                    isError: true
                };
            }

            const results: string[] = [];
            const regex = new RegExp(pattern, 'gi');
            const MAX_SEARCH_FILES = CAPACITY.MCP_MAX_SEARCH_FILES;
            let scannedFiles = 0;

            async function searchDir(dir: string): Promise<void> {
                if (scannedFiles >= MAX_SEARCH_FILES) {
                    return;
                }

                // 🔒 심볼릭 링크를 통한 탈출 방지: 실제 경로도 검증
                let realDir: string;
                try {
                    realDir = await fs.promises.realpath(dir);
                } catch {
                    return;
                }

                if (!realDir.startsWith(projectRoot)) {
                    return;
                }

                let entries: fs.Dirent[];
                try {
                    entries = await fs.promises.readdir(dir, { withFileTypes: true });
                } catch {
                    return;
                }

                for (const entry of entries) {
                    if (scannedFiles >= MAX_SEARCH_FILES) {
                        return;
                    }

                    const fullPath = path.join(dir, entry.name);

                    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        await searchDir(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name);
                        if (extensions.includes(ext)) {
                            scannedFiles++;
                            try {
                                const content = await fs.promises.readFile(fullPath, 'utf-8');
                                const lines = content.split('\n');

                                lines.forEach((line, index) => {
                                    regex.lastIndex = 0;
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

            await searchDir(resolvedDir);

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
 *
 * MCP 도구 형식으로 정의되어 있으나, 실제 OCR 처리는
 * ChatService에서 비전 모델을 통해 수행됩니다.
 * 이 핸들러는 MCP 프로토콜 호환성을 위한 스텁(stub)입니다.
 *
 * @param args.image_path - 이미지 파일 경로 (절대 또는 상대)
 * @param args.image_base64 - Base64 인코딩된 이미지 데이터 (image_path 대안)
 * @param args.language - OCR 대상 언어 코드 (ko, en, ja 등)
 * @returns 비전 모델 위임 안내 메시지
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
 *
 * 사진, 다이어그램, 차트 등의 이미지 콘텐츠를 분석합니다.
 * visionOcrTool과 마찬가지로, 실제 처리는 ChatService의 비전 모델이 담당합니다.
 *
 * @param args.image_path - 분석할 이미지 파일 경로
 * @param args.image_base64 - Base64 인코딩된 이미지 데이터
 * @param args.question - 이미지에 대한 질문 (선택적)
 * @returns 비전 모델 위임 안내 메시지
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

/**
 * 전체 내장 도구 배열
 *
 * ToolRouter와 MCPServer에서 사용하는 모든 내장 도구 목록입니다.
 * Firecrawl 도구는 FIRECRAWL_API_KEY가 설정된 경우에만 포함됩니다.
 *
 * 포함된 도구:
 * - visionOcrTool: 이미지 OCR (비전 모델 위임)
 * - analyzeImageTool: 이미지 분석 (비전 모델 위임)
 * - webSearchTools: 웹 검색, 사실 검증, 웹페이지 추출, 주제 연구
 * - firecrawlTools: 스크래핑, 검색, URL 매핑, 크롤링 (조건부)
 *
 * @security 2026-02-07 보안 패치: runCommandTool(RCE), readFileTool/writeFileTool(샌드박스 미적용) 제거
 */
export const builtInTools: MCPToolDefinition[] = [
    visionOcrTool,
    analyzeImageTool,
    ...webSearchTools,
    ...(isFirecrawlConfigured() ? firecrawlTools : []),
];
