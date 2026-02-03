/**
 * ============================================================
 * Deep Research MCP 도구
 * ============================================================
 * 
 * ollama-deep-researcher와 유사한 MCP 도구 제공:
 * - research: 심층 연구 시작
 * - get_research_status: 진행 상황 조회
 * - configure_research: 설정 변경
 * 
 * @module mcp/deep-research
 */

import { MCPToolDefinition, MCPToolResult } from './types';
import { getUnifiedDatabase } from '../data/models/unified-database';
import {
    createDeepResearchService,
    getResearchConfig,
    configureResearch as configureResearchGlobal,
    ResearchConfig,
    ResearchProgress
} from '../services/DeepResearchService';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';

const logger = createLogger('DeepResearchMCP');

// ============================================================
// 진행 중인 리서치 추적
// ============================================================

const activeResearches = new Map<string, {
    progress: ResearchProgress;
    startTime: number;
}>();

// ============================================================
// research 도구
// ============================================================

interface ResearchToolArgs extends Record<string, unknown> {
    topic: string;
    depth?: 'quick' | 'standard' | 'deep';
    userId?: string;
}

export const researchTool: MCPToolDefinition = {
    tool: {
        name: 'research',
        description: '주제에 대한 심층 연구를 수행합니다. 웹 검색, LLM 분석, 반복 검증을 통해 종합 보고서를 생성합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: '연구할 주제 또는 질문'
                },
                depth: {
                    type: 'string',
                    enum: ['quick', 'standard', 'deep'],
                    description: '연구 깊이: quick(빠른 검색), standard(표준), deep(심층)'
                },
                userId: {
                    type: 'string',
                    description: '사용자 ID (선택사항)'
                }
            },
            required: ['topic']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        const topic = args.topic as string;
        const depth = (args.depth as 'quick' | 'standard' | 'deep') || 'standard';
        const userId = (args.userId as string) || 'anonymous';

        logger.info(`[DeepResearch MCP] 리서치 시작: ${topic} (depth: ${depth})`);

        try {
            const db = getUnifiedDatabase();
            const sessionId = uuidv4();

            // 세션 생성 (anonymous/guest userId는 FK 위반 방지를 위해 null 처리)
            const safeUserId = userId && userId !== 'guest' && !userId.startsWith('anon-') && userId !== 'anonymous'
                ? userId : undefined;
            await db.createResearchSession({
                id: sessionId,
                userId: safeUserId,
                topic,
                depth
            });

            // 진행 상황 초기화
            activeResearches.set(sessionId, {
                progress: {
                    sessionId,
                    status: 'running',
                    currentLoop: 0,
                    totalLoops: depth === 'quick' ? 1 : depth === 'standard' ? 3 : 5,
                    currentStep: 'starting',
                    progress: 0,
                    message: '리서치를 시작합니다...'
                },
                startTime: Date.now()
            });

            // depth에 따른 maxLoops 설정
            const maxLoops = depth === 'quick' ? 1 : depth === 'standard' ? 3 : 5;

            // 비동기로 리서치 실행 (블로킹하지 않음)
            const service = createDeepResearchService({ maxLoops });
            
            // 백그라운드 실행
            service.executeResearch(sessionId, topic, (progress) => {
                activeResearches.set(sessionId, {
                    progress,
                    startTime: activeResearches.get(sessionId)?.startTime || Date.now()
                });
            }).then((result) => {
                logger.info(`[DeepResearch MCP] 완료: ${sessionId}`);
                // 완료 후 일정 시간 후 정리
                setTimeout(() => activeResearches.delete(sessionId), 300000); // 5분 후 정리
            }).catch((error) => {
                logger.error(`[DeepResearch MCP] 실패: ${error}`);
            });

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        sessionId,
                        status: 'started',
                        topic,
                        depth,
                        message: `"${topic}" 주제에 대한 심층 연구가 시작되었습니다. get_research_status 도구로 진행 상황을 확인하세요.`,
                        estimatedTime: depth === 'quick' ? '1-2분' : depth === 'standard' ? '3-5분' : '5-10분'
                    }, null, 2)
                }]
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`[DeepResearch MCP] 오류: ${errorMessage}`);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: errorMessage
                    }, null, 2)
                }],
                isError: true
            };
        }
    }
};

// ============================================================
// get_research_status 도구
// ============================================================

interface GetStatusToolArgs extends Record<string, unknown> {
    sessionId: string;
}

export const getResearchStatusTool: MCPToolDefinition = {
    tool: {
        name: 'get_research_status',
        description: '진행 중인 리서치의 상태와 진행 상황을 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: {
                    type: 'string',
                    description: '리서치 세션 ID'
                }
            },
            required: ['sessionId']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        const sessionId = args.sessionId as string;

        try {
            const db = getUnifiedDatabase();
            const session = await db.getResearchSession(sessionId);

            if (!session) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: '세션을 찾을 수 없습니다.'
                        }, null, 2)
                    }],
                    isError: true
                };
            }

            const steps = await db.getResearchSteps(sessionId);
            const activeProgress = activeResearches.get(sessionId);

            // 실시간 진행 상황 또는 DB 상태 반환
            const progress = activeProgress?.progress || {
                sessionId,
                status: session.status,
                currentLoop: 0,
                totalLoops: session.depth === 'quick' ? 1 : session.depth === 'standard' ? 3 : 5,
                currentStep: session.status,
                progress: session.progress || 0,
                message: session.status === 'completed' ? '리서치 완료' : session.status === 'failed' ? '리서치 실패' : '상태 확인 중'
            };

            const result: Record<string, unknown> = {
                success: true,
                session: {
                    id: session.id,
                    topic: session.topic,
                    status: session.status,
                    depth: session.depth,
                    progress: session.progress,
                    createdAt: session.created_at,
                    completedAt: session.completed_at
                },
                progress,
                stepsCount: steps.length
            };

            // 완료된 경우 결과 포함
            if (session.status === 'completed') {
                result.result = {
                    summary: session.summary,
                    keyFindings: session.key_findings,
                    sources: session.sources
                };
            }

            // 최근 스텝 정보
            if (steps.length > 0) {
                result.recentSteps = steps.slice(-5).map(step => ({
                    stepNumber: step.step_number,
                    stepType: step.step_type,
                    status: step.status,
                    query: step.query?.slice(0, 100)
                }));
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: errorMessage
                    }, null, 2)
                }],
                isError: true
            };
        }
    }
};

// ============================================================
// configure_research 도구
// ============================================================

interface ConfigureToolArgs extends Record<string, unknown> {
    maxLoops?: number;
    llmModel?: string;
    searchApi?: 'ollama' | 'firecrawl' | 'google' | 'all';
    maxSearchResults?: number;
    language?: 'ko' | 'en';
}

export const configureResearchTool: MCPToolDefinition = {
    tool: {
        name: 'configure_research',
        description: '심층 연구의 기본 설정을 변경합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                maxLoops: {
                    type: 'number',
                    description: '최대 반복 횟수 (1-10)'
                },
                llmModel: {
                    type: 'string',
                    description: '사용할 LLM 모델 이름'
                },
                searchApi: {
                    type: 'string',
                    enum: ['ollama', 'firecrawl', 'google', 'all'],
                    description: '웹 검색 API 선택'
                },
                maxSearchResults: {
                    type: 'number',
                    description: '검색 결과 최대 수 (5-50)'
                },
                language: {
                    type: 'string',
                    enum: ['ko', 'en'],
                    description: '출력 언어'
                }
            }
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        try {
            // 타입 캐스팅
            const maxLoops = args.maxLoops as number | undefined;
            const llmModel = args.llmModel as string | undefined;
            const searchApi = args.searchApi as 'ollama' | 'firecrawl' | 'google' | 'all' | undefined;
            const maxSearchResults = args.maxSearchResults as number | undefined;
            const language = args.language as 'ko' | 'en' | undefined;

            // 값 검증
            const updates: Partial<ResearchConfig> = {};

            if (maxLoops !== undefined) {
                if (maxLoops < 1 || maxLoops > 10) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: 'maxLoops는 1-10 사이여야 합니다.'
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
                updates.maxLoops = maxLoops;
            }

            if (llmModel !== undefined) {
                updates.llmModel = llmModel;
            }

            if (searchApi !== undefined) {
                updates.searchApi = searchApi;
            }

            if (maxSearchResults !== undefined) {
                if (maxSearchResults < 5 || maxSearchResults > 50) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: 'maxSearchResults는 5-50 사이여야 합니다.'
                            }, null, 2)
                        }],
                        isError: true
                    };
                }
                updates.maxSearchResults = maxSearchResults;
            }

            if (language !== undefined) {
                updates.language = language;
            }

            // 설정 업데이트
            const newConfig = configureResearchGlobal(updates);

            logger.info(`[DeepResearch MCP] 설정 변경: ${JSON.stringify(updates)}`);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        message: '설정이 업데이트되었습니다.',
                        config: newConfig
                    }, null, 2)
                }]
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: errorMessage
                    }, null, 2)
                }],
                isError: true
            };
        }
    }
};

// ============================================================
// 도구 배열 export
// ============================================================

export const deepResearchTools: MCPToolDefinition[] = [
    researchTool,
    getResearchStatusTool,
    configureResearchTool
];

// 개별 도구도 export
export { researchTool as research, getResearchStatusTool as getStatus, configureResearchTool as configure };
