/**
 * ============================================================
 * MCP Tools - 내장 MCP 도구 정의
 * ============================================================
 *
 * MCP 시스템에서 제공하는 내장(built-in) 도구들을 정의합니다.
 * 이미지 OCR/분석, 웹 검색, 웹 스크래핑 등의 도구를 포함합니다.
 *
 * @module mcp/tools
 * @description
 * - vision_ocr / analyze_image: 비전 모델 기반 이미지 처리 (ChatService 위임)
 * - 웹 검색 도구 (web-search.ts에서 가져오기)
 * - 웹 스크래핑 도구 (web-scraper-tools.ts에서 가져오기)
 *
 * @security
 * - 2026-02-07 보안 패치: run_command(RCE), read_file/write_file(샌드박스 미적용) 제거
 * - 안전한 파일 도구는 ./filesystem에서 제공
 */

import { MCPToolDefinition, MCPToolResult } from './types';

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
// 웹 스크래핑 MCP 도구 가져오기 (Firecrawl 대체 — API 키 불필요, 항상 활성)
import { webScraperTools } from './web-scraper-tools';

/**
 * 전체 내장 도구 배열
 *
 * ToolRouter와 MCPServer에서 사용하는 모든 내장 도구 목록입니다.
 *
 * 포함된 도구:
 * - visionOcrTool: 이미지 OCR (비전 모델 위임)
 * - analyzeImageTool: 이미지 분석 (비전 모델 위임)
 * - webSearchTools: 웹 검색, 사실 검증, 웹페이지 추출, 주제 연구
 * - webScraperTools: 스크래핑, URL 매핑, 크롤링 (항상 활성)
 *
 * @security 2026-02-07 보안 패치: runCommandTool(RCE), readFileTool/writeFileTool(샌드박스 미적용) 제거
 */
export const builtInTools: MCPToolDefinition[] = [
    visionOcrTool,
    analyzeImageTool,
    ...webSearchTools,
    ...webScraperTools,
];
