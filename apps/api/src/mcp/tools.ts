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
import { agentTaskTools } from './agent-task-tools';
import { imageTools } from './image-tools';

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
        description: '이미지에서 텍스트를 추출합니다 (OCR). 문서·스크린샷·영수증·표지판 등에서 글자만 그대로 읽어야 할 때 사용하세요. 이미지의 내용을 설명·해석해야 하면 analyze_image를 사용하세요. image_path 또는 image_base64 중 하나가 필요합니다.',
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
    handler: async (_args): Promise<MCPToolResult> => {
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
        description: '이미지의 내용을 분석하고 설명합니다. 사진·다이어그램·차트·UI 등 무엇이 담겼는지 이해·해석하거나 이미지에 대한 질문에 답할 때 사용하세요. 글자만 그대로 추출하려면 analyze 대신 vision_ocr를 사용하세요. image_path 또는 image_base64 중 하나가 필요합니다.',
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
    handler: async (_args): Promise<MCPToolResult> => {
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
// Skill Creator 도구 (Phase 1) — 자연어 purpose → LLM 매니페스트 → draft
import { createSkillTool } from './skill-creator-tool';
// Git URL → Skill 매니페스트 ingest (Phase 2.5) — GitHub URL → draft
import { importSkillFromGitTool } from './git-ingest-tool';
// Git URL → Agent 매니페스트 ingest (Phase 3.5) — chained skill ingest 포함
import { importAgentFromGitTool } from './agent-ingest-tool';
// Git URL → MCP server 매니페스트 ingest (Phase 4.5) — 3중 잠금 draft + 위험 명령 차단
import { importMcpServerFromGitTool } from './mcp-server-ingest-tool';
// 보안 리뷰 (P-2) — 코드 취약점 분석 (읽기 전용)
import { securityReviewTool } from './security-review-tool';
// Plan Mode (P-3) — 구현 전 읽기 전용 실행 계획 생성
import { createPlanTool } from './plan-tool';
// 코드 리뷰 (P-1) — 다각도 코드 검토 (읽기 전용)
import { codeReviewTool } from './code-review-tool';
// 스킬 자동 호출 (LLM self-select) — 카탈로그는 getAllowedTools 가 description 에 주입
import { loadSkillTool } from './load-skill-tool';
// MCP 진행적 공개 메타 도구 (B) — 노출은 getAllowedTools 가 플래그로 게이트, 등록은 실행 라우팅용
import { mcpMetaTools } from './mcp-meta-tools';

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
    ...agentTaskTools,
    ...imageTools,
    createSkillTool as MCPToolDefinition,
    importSkillFromGitTool as MCPToolDefinition,
    importAgentFromGitTool as MCPToolDefinition,
    importMcpServerFromGitTool as MCPToolDefinition,
    securityReviewTool,
    createPlanTool,
    codeReviewTool,
    loadSkillTool as MCPToolDefinition,
    ...mcpMetaTools,
];
