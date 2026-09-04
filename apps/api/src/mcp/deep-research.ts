/**
 * ============================================================
 * Deep Research MCP 도구
 * ============================================================
 * 
 * deep-researcher 패턴과 유사한 MCP 도구 제공:
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
    getResearchMessage,
    ResearchConfig,
    ResearchProgress
} from '../services/DeepResearchService';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';
import { isPersistableUserId } from '../utils/user-id-validation';
import { detectLanguage } from '../chat/language-policy';
import { CLEANUP_INTERVALS } from '../config/timeouts';
import { RESEARCH_DEPTH_LOOPS, RESEARCH_DEFAULTS } from '../config/runtime-limits';

const logger = createLogger('DeepResearchMCP');

// ============================================================
// 진행 중인 리서치 추적
// ============================================================

/**
 * 활성 리서치 세션 맵
 *
 * 현재 진행 중인 리서치의 실시간 진행 상황을 메모리에 보관합니다.
 * 완료 후 5분(300초) 뒤 자동 정리됩니다.
 *
 * Key: sessionId (UUID)
 * Value: { progress: 실시간 진행 상황, startTime: 시작 시각 }
 */
const activeResearches = new Map<string, {
    progress: ResearchProgress;
    startTime: number;
}>();

/**
 * configure_research 의 사용자별 설정 override (프로세스 메모리).
 * 2026-09-05 정정: 종전엔 DeepResearchService 의 전역 config 를 바꿔 한 사용자의 호출이
 * 이후 모든 사용자의 리서치에 적용됐다. 이제 userId 키로 격리하고 research 도구가 자기 것만 합친다.
 */
const userResearchOverrides = new Map<string, Partial<ResearchConfig>>();
const OVERRIDE_KEY_ANONYMOUS = 'anonymous';

function overrideKey(userId: unknown): string {
    return typeof userId === 'string' && userId.trim() ? userId : OVERRIDE_KEY_ANONYMOUS;
}

/** 테스트·research 도구용 — 해당 사용자의 override 사본 */
export function getUserResearchOverrides(userId: unknown): Partial<ResearchConfig> {
    return { ...(userResearchOverrides.get(overrideKey(userId)) ?? {}) };
}

// ============================================================
// research 도구
// ============================================================

/**
 * 심층 연구 도구 (research)
 *
 * 주제에 대해 웹 검색, LLM 분석, 반복 검증을 수행하여
 * 종합 보고서를 생성하는 비동기 MCP 도구입니다.
 * 리서치는 백그라운드에서 실행되며, get_research_status로 진행 상황을 확인합니다.
 *
 * @param args.topic - 연구 주제 (필수)
 * @param args.depth - 연구 깊이: quick(1-2분), standard(3-5분), deep(5-10분)
 * @param args.userId - 사용자 ID (선택적)
 * @returns 세션 ID 및 시작 확인 메시지 (JSON)
 */
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
                },
                language: {
                    type: 'string',
                    enum: ['ko', 'en', 'ja', 'zh', 'es', 'de', 'fr'],
                    description: '출력 언어 (미지정 시 topic에서 자동 감지)'
                }
            },
            required: ['topic']
        }
    },
    handler: async (args): Promise<MCPToolResult> => {
        const topic = args.topic as string;
        const depth = (args.depth as 'quick' | 'standard' | 'deep') || 'standard';
        const userId = (args.userId as string) || 'anonymous';
        const requestedLanguage = args.language as string | undefined;
        const language = requestedLanguage || detectLanguage(topic).language;

        logger.info(`[DeepResearch MCP] 리서치 시작: ${topic} (depth: ${depth})`);

        try {
            const db = getUnifiedDatabase();
            const sessionId = uuidv4();

            // 세션 생성 (anonymous/guest userId는 FK 위반 방지를 위해 null 처리)
            const safeUserId = isPersistableUserId(userId) ? userId : undefined;
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
                    totalLoops: RESEARCH_DEPTH_LOOPS[depth],
                    currentStep: 'starting',
                    progress: 0,
                    message: getResearchMessage('init', language)
                },
                startTime: Date.now()
            });

            // depth → 루프 수는 REST 와 같은 단일 표(RESEARCH_DEPTH_LOOPS). 사용자 configure_research 의 maxLoops 가 있으면 우선.
            const overrides = getUserResearchOverrides(userId);
            const maxLoops = overrides.maxLoops ?? RESEARCH_DEPTH_LOOPS[depth];

            // 비동기로 리서치 실행 (블로킹하지 않음)
            const service = createDeepResearchService({ ...overrides, maxLoops, language });
            
            // 백그라운드 실행
            service.executeResearch(sessionId, topic, (progress) => {
                activeResearches.set(sessionId, {
                    progress,
                    startTime: activeResearches.get(sessionId)?.startTime || Date.now()
                });
            }).then(() => {
                logger.info(`[DeepResearch MCP] 완료: ${sessionId}`);
                // 완료 후 일정 시간 후 정리
                setTimeout(() => activeResearches.delete(sessionId), CLEANUP_INTERVALS.RESEARCH_SESSION_MS); // 5분 후 정리
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

/**
 * 리서치 상태 조회 도구 (get_research_status)
 *
 * 진행 중인 리서치의 실시간 진행 상황 또는 완료된 결과를 조회합니다.
 * activeResearches 맵의 실시간 데이터를 우선 사용하고,
 * 없으면 DB에서 세션 정보를 가져옵니다.
 *
 * @param args.sessionId - 리서치 세션 ID (필수)
 * @returns 세션 정보, 진행 상황, 최근 스텝, 완료 시 결과 포함 (JSON)
 */
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
                totalLoops: RESEARCH_DEPTH_LOOPS[session.depth as keyof typeof RESEARCH_DEPTH_LOOPS] ?? RESEARCH_DEPTH_LOOPS.standard,
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

/**
 * 리서치 설정 변경 도구 (configure_research)
 *
 * 심층 연구의 글로벌 기본 설정을 변경합니다.
 * 입력 값의 범위를 검증하고, 유효한 항목만 업데이트합니다.
 *
 * @param args.maxLoops - 최대 반복 횟수 (1-10)
 * @param args.llmModel - LLM 모델명
 * @param args.maxSearchResults - 최대 검색 결과 수 (5-200)
 * @param args.language - 출력 언어 (ko/en/ja/zh/es/de)
 * @returns 업데이트된 설정 (JSON)
 */
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
                maxSearchResults: {
                    type: 'number',
                    description: '검색 결과 최대 수 (5-200)'
                },
                language: {
                    type: 'string',
                    enum: ['ko', 'en', 'ja', 'zh', 'es', 'de', 'fr'],
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
            const maxSearchResults = args.maxSearchResults as number | undefined;
            const language = args.language as string | undefined;

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

            if (maxSearchResults !== undefined) {
                // 상한은 기본값(RESEARCH_DEFAULTS.MAX_SEARCH_RESULTS)까지 — 종전 50 은 기본 200 보다 작아 실제 값을 표현할 수 없었다
                if (maxSearchResults < 5 || maxSearchResults > RESEARCH_DEFAULTS.MAX_SEARCH_RESULTS) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                success: false,
                                error: `maxSearchResults는 5-${RESEARCH_DEFAULTS.MAX_SEARCH_RESULTS} 사이여야 합니다.`
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

            // 사용자별 override 갱신 (전역 config 는 건드리지 않는다)
            const key = overrideKey(args.userId);
            const newConfig = { ...(userResearchOverrides.get(key) ?? {}), ...updates };
            userResearchOverrides.set(key, newConfig);

            logger.info(`[DeepResearch MCP] 설정 변경(user=${key}): ${JSON.stringify(updates)}`);

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

/**
 * Deep Research MCP 도구 배열
 *
 * 심층 연구 관련 전체 도구를 하나의 배열로 내보냅니다.
 * - research: 리서치 시작
 * - get_research_status: 진행 상황 조회
 * - configure_research: 설정 변경
 */
export const deepResearchTools: MCPToolDefinition[] = [
    researchTool,
    getResearchStatusTool,
    configureResearchTool
];
