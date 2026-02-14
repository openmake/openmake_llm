/**
 * LLM-Based Agent Router
 * 🆕 질문 전체를 LLM으로 분석하여 가장 적합한 에이전트 선택
 */

import { OllamaClient } from '../ollama/client';
import { sanitizePromptInput, validatePromptInput } from '../utils/input-sanitizer';
import { Agent, AgentCategory } from './types';
import industryData from './industry-agents.json';

// LLM 라우팅 결과 인터페이스
export interface LLMRoutingResult {
    agentId: string;
    confidence: number;
    reasoning: string;
    alternativeAgents: string[];
}

// 에이전트 요약 (LLM 프롬프트용)
interface AgentSummary {
    id: string;
    name: string;
    category: string;
    description: string;
}

// 전역 OllamaClient (싱글톤)
let routerClient: OllamaClient | null = null;

function getRouterClient(): OllamaClient {
    if (!routerClient) {
        routerClient = new OllamaClient();
    }
    return routerClient;
}

/**
 * 모든 에이전트의 간결한 요약 생성
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
 * 에이전트 목록을 LLM 프롬프트용 문자열로 변환
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
 * LLM 응답에서 JSON 추출 (greedy + non-greedy 이중 시도)
 */
function extractJSONFromResponse(response: string): Record<string, unknown> | null {
    // 1단계: ```json 코드블록 내 JSON 추출 시도
    const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1]);
        } catch {
            // 코드블록 내 파싱 실패 시 다음 단계로
        }
    }

    // 2단계: Greedy 매칭 (중첩 브레이스 대응 — 가장 바깥 {} 블록)
    const greedyMatch = response.match(/\{[\s\S]*\}/);
    if (greedyMatch) {
        try {
            return JSON.parse(greedyMatch[0]);
        } catch {
            // greedy 실패 시 non-greedy 시도
        }
    }

    // 3단계: Non-greedy 폴백 (가장 짧은 {} 블록)
    const lazyMatch = response.match(/\{[\s\S]*?\}/);
    if (lazyMatch) {
        try {
            return JSON.parse(lazyMatch[0]);
        } catch (e) {
            console.log('[LLM Router] JSON 파싱 실패, 응답:', response.substring(0, 200));
            return null;
        }
    }

    return null;
}

/**
 * LLM 기반 에이전트 라우팅
 */
export async function routeWithLLM(
    message: string,
    timeout: number = 5000
): Promise<LLMRoutingResult | null> {
    const client = getRouterClient();
    const summaries = getAgentSummaries();
    const agentList = formatAgentListForPrompt(summaries);

    const systemPrompt = `당신은 AI 에이전트 라우터입니다. 사용자 질문을 분석하여 가장 적합한 전문가를 선택하세요.

## 분석 단계 (반드시 순서대로 수행):
1. **핵심 의도 파악**: 사용자가 원하는 것이 무엇인가?
2. **도메인 식별**: 어떤 분야와 관련된 질문인가?
3. **전문성 유형**: 어떤 종류의 전문가가 필요한가?

## 규칙:
1. 키워드가 아닌 **질문 전체 맥락**을 분석하세요
2. 질문의 **숨겨진 의도**도 파악하세요
3. 가장 적합한 전문가 **1명**을 선택하세요
4. 확신이 없어도 가장 근접한 전문가를 선택하세요

## 사용 가능한 전문가 목록:
${agentList}

## 응답 형식 (반드시 JSON만 출력):
{
  "agent_id": "선택한 에이전트 ID",
  "confidence": 0.0-1.0 사이의 신뢰도,
  "reasoning": "선택 이유 (한 문장)",
  "alternatives": ["대안1 ID", "대안2 ID"]
}`;

    // 🔧 라우팅 목적으로는 메시지 앞부분만 필요 — 긴 문서 입력은 잘라내기
    const MAX_ROUTING_INPUT = 10000;
    const routingInput = message.length > MAX_ROUTING_INPUT ? message.slice(0, MAX_ROUTING_INPUT) : message;

    // Sanitize user input before embedding in prompt
    const validation = validatePromptInput(routingInput);
    if (!validation.valid) {
        console.log('[LLM Router] 입력 검증 실패:', validation.error);
        return null;
    }
    const sanitizedMessage = sanitizePromptInput(routingInput);

    const userPrompt = `<user_message>
${sanitizedMessage}
</user_message>

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
                agentId: String(parsed.agent_id),
                confidence: Number(parsed.confidence) || 0.85,
                reasoning: String(parsed.reasoning || ''),
                alternativeAgents: Array.isArray(parsed.alternatives) ? parsed.alternatives as string[] : []
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
 * 에이전트 ID가 유효한지 확인
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
