/**
 * @fileoverview LLM 기반 에이전트 라우터
 * 
 * 사용자 질문을 LLM으로 분석하여 가장 적합한 전문가 에이전트를 선택합니다.
 * 단순 키워드 매칭이 아닌 전체 맥락을 이해하여 라우팅합니다.
 * 
 * @module agents/llm-router
 * 
 * @example
 * ```typescript
 * import { routeWithLLM, isValidAgentId } from './llm-router';
 * 
 * const result = await routeWithLLM('AI 스타트업 창업하려는데 조언 부탁드립니다');
 * if (result && isValidAgentId(result.agentId)) {
 *   console.log(`선택된 에이전트: ${result.agentId}`);
 *   console.log(`신뢰도: ${result.confidence}`);
 *   console.log(`이유: ${result.reasoning}`);
 * }
 * ```
 */

import { OllamaClient } from '../ollama/client';
import { Agent, AgentCategory } from './types';
import industryData from './industry-agents.json';

/**
 * LLM 라우팅 결과 인터페이스
 * 
 * LLM이 분석한 에이전트 선택 결과를 담습니다.
 */
export interface LLMRoutingResult {
    /** 선택된 에이전트 ID */
    agentId: string;
    /** 선택 신뢰도 (0.0 ~ 1.0) */
    confidence: number;
    /** 선택 이유 설명 */
    reasoning: string;
    /** 대안 에이전트 ID 목록 */
    alternativeAgents: string[];
}

/**
 * 에이전트 요약 정보 (LLM 프롬프트용)
 * 
 * LLM에게 전달할 에이전트 정보의 간결한 형태입니다.
 */
interface AgentSummary {
    /** 에이전트 고유 ID */
    id: string;
    /** 에이전트 표시 이름 */
    name: string;
    /** 소속 카테고리 */
    category: string;
    /** 에이전트 설명 */
    description: string;
}

/** 전역 OllamaClient (싱글톤) - 라우팅 전용 */
let routerClient: OllamaClient | null = null;

/**
 * 라우터용 Ollama 클라이언트 획득 (싱글톤)
 * 
 * @returns OllamaClient 인스턴스
 * @internal
 */
function getRouterClient(): OllamaClient {
    if (!routerClient) {
        routerClient = new OllamaClient();
    }
    return routerClient;
}

/**
 * 모든 에이전트의 간결한 요약 생성
 * 
 * industry-agents.json에 정의된 모든 에이전트를
 * LLM 프롬프트에 사용할 수 있는 형태로 변환합니다.
 * 
 * @returns 에이전트 요약 정보 배열
 */
export function getAgentSummaries(): AgentSummary[] {
    const summaries: AgentSummary[] = [];

    for (const [categoryId, category] of Object.entries(industryData as Record<string, AgentCategory>)) {
        for (const agent of category.agents) {
            summaries.push({
                id: agent.id,
                name: agent.name,
                category: category.name,
                description: agent.description
            });
        }
    }

    return summaries;
}

/**
 * 에이전트 목록을 LLM 프롬프트용 마크다운 문자열로 변환
 * 
 * 카테고리별로 그룹화하여 가독성 있는 형식으로 출력합니다.
 * 
 * @param summaries - 에이전트 요약 배열
 * @returns 마크다운 형식의 에이전트 목록 문자열
 * @internal
 */
function formatAgentListForPrompt(summaries: AgentSummary[]): string {
    // 카테고리별로 그룹화
    const byCategory = new Map<string, AgentSummary[]>();

    for (const agent of summaries) {
        const existing = byCategory.get(agent.category) || [];
        existing.push(agent);
        byCategory.set(agent.category, existing);
    }

    let result = '';
    for (const [category, agents] of byCategory) {
        result += `\n### ${category}\n`;
        for (const agent of agents) {
            result += `- **${agent.id}**: ${agent.name} - ${agent.description}\n`;
        }
    }

    return result;
}

/**
 * LLM 응답에서 JSON 객체 추출
 * 
 * LLM 응답 텍스트에서 첫 번째 JSON 객체를 찾아 파싱합니다.
 * 
 * @param response - LLM 응답 텍스트
 * @returns 파싱된 JSON 객체 또는 null (파싱 실패 시)
 * @internal
 */
function extractJSONFromResponse(response: string): any {
    // JSON 블록 찾기
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.log('[LLM Router] JSON 파싱 실패, 응답:', response);
            return null;
        }
    }
    return null;
}

/**
 * LLM 기반 에이전트 라우팅
 * 
 * 사용자 메시지를 LLM으로 분석하여 최적의 에이전트를 선택합니다.
 * 단순 키워드 매칭이 아닌 질문의 전체 맥락과 의도를 파악합니다.
 * 
 * @param message - 사용자 질문/메시지
 * @param timeout - 타임아웃 (ms, 기본값: 5000)
 * @returns 라우팅 결과 또는 null (타임아웃/오류 발생 시)
 * 
 * @example
 * ```typescript
 * const result = await routeWithLLM('Python으로 웹 크롤러 만드는 방법', 3000);
 * if (result) {
 *   console.log(`에이전트: ${result.agentId}, 신뢰도: ${result.confidence}`);
 * } else {
 *   console.log('라우팅 실패 - 폴백 에이전트 사용');
 * }
 * ```
 */
export async function routeWithLLM(
    message: string,
    timeout: number = 5000
): Promise<LLMRoutingResult | null> {
    const client = getRouterClient();
    const summaries = getAgentSummaries();
    const agentList = formatAgentListForPrompt(summaries);

    const systemPrompt = `당신은 AI 에이전트 라우터입니다. 사용자 질문을 분석하여 가장 적합한 전문가를 선택하세요.

## 규칙:
1. 질문의 핵심 **의도와 도메인**을 파악하세요
2. 단어가 아닌 **질문 전체 맥락**을 분석하세요
3. 가장 적합한 전문가 **1명**을 선택하세요

## 사용 가능한 전문가 목록:
${agentList}

## 응답 형식 (반드시 JSON만 출력):
{
  "agent_id": "선택한 에이전트 ID",
  "confidence": 0.0-1.0 사이의 신뢰도,
  "reasoning": "선택 이유 (한 문장)",
  "alternatives": ["대안1 ID", "대안2 ID"]
}`;

    const userPrompt = `사용자 질문: "${message}"

위 질문에 가장 적합한 전문가를 선택하고 JSON 형식으로만 응답하세요.`;

    try {
        // 타임아웃 설정
        const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), timeout);
        });

        const routingPromise = (async () => {
            const response = await client.chat([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ], {
                temperature: 0.1,  // 결정적인 응답을 위해 낮은 온도
                num_predict: 200   // 짧은 응답만 필요
            });

            return response.content;
        })();

        const result = await Promise.race([routingPromise, timeoutPromise]);

        if (!result) {
            console.log('[LLM Router] 타임아웃 - 폴백 사용');
            return null;
        }

        const parsed = extractJSONFromResponse(result);

        if (parsed && parsed.agent_id) {
            console.log(`[LLM Router] 선택: ${parsed.agent_id} (신뢰도: ${parsed.confidence})`);
            console.log(`[LLM Router] 이유: ${parsed.reasoning}`);

            return {
                agentId: parsed.agent_id,
                confidence: parsed.confidence || 0.8,
                reasoning: parsed.reasoning || '',
                alternativeAgents: parsed.alternatives || []
            };
        }

        console.log('[LLM Router] 유효하지 않은 응답 형식');
        return null;

    } catch (error) {
        console.error('[LLM Router] 오류:', error);
        return null;
    }
}

/**
 * 에이전트 ID 유효성 검증
 * 
 * 주어진 ID가 등록된 에이전트 중 존재하는지 확인합니다.
 * 'general' ID는 항상 유효한 것으로 처리됩니다.
 * 
 * @param agentId - 검증할 에이전트 ID
 * @returns 유효한 에이전트 ID 여부
 * 
 * @example
 * ```typescript
 * if (isValidAgentId(result.agentId)) {
 *   // 에이전트 사용
 * } else {
 *   // 기본 에이전트로 폴백
 * }
 * ```
 */
export function isValidAgentId(agentId: string): boolean {
    for (const [, category] of Object.entries(industryData as Record<string, AgentCategory>)) {
        for (const agent of category.agents) {
            if (agent.id === agentId) {
                return true;
            }
        }
    }
    return agentId === 'general';
}
