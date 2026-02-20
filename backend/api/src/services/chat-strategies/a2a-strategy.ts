/**
 * ============================================================
 * A2AStrategy - Agent-to-Agent 병렬 생성 전략
 * ============================================================
 *
 * 두 개의 LLM 모델에 동시에 요청하여 병렬로 응답을 생성하고,
 * 합성 모델이 두 응답을 종합하여 최고 품질의 최종 답변을 생성합니다.
 *
 * @module services/chat-strategies/a2a-strategy
 * @description
 * - Primary + Secondary 모델 병렬 호출 (Promise.allSettled)
 * - 양쪽 모두 성공 시 Synthesizer 모델이 응답 종합
 * - 한쪽만 성공 시 해당 응답을 단독 사용
 * - 양쪽 모두 실패 시 succeeded=false 반환 (AgentLoop 폴백 트리거)
 */
import { OllamaClient } from '../../ollama/client';
import type { ChatStrategy, A2AStrategyContext, A2AStrategyResult } from './types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('A2AStrategy');

/**
 * A2A 모델 조합 타입
 * resolveA2AModels()가 반환하는 primary/secondary/synthesizer 모델 세트
 */
interface A2AModelSelection {
    /** 1차 응답 생성 모델 */
    primary: string;
    /** 2차 응답 생성 모델 */
    secondary: string;
    /** 두 응답을 종합하는 합성 모델 */
    synthesizer: string;
}

/**
 * QueryType 미지정 또는 매핑 없는 유형에 대한 기본 A2A 모델 조합
 * @constant
 */
const DEFAULT_A2A_MODELS: A2AModelSelection = {
    primary: 'gpt-oss:120b-cloud',
    secondary: 'gemini-3-flash-preview:cloud',
    synthesizer: 'gemini-3-flash-preview:cloud',
};

/**
 * 질문 유형(QueryType)에 따라 최적의 A2A 모델 조합을 선택합니다.
 *
 * ollama list에서 확인된 모델만 사용:
 * - gemini-3-flash-preview:cloud (범용 Fast)
 * - gpt-oss:120b-cloud (대형 범용)
 * - qwen3-coder-next:cloud (코드 특화)
 * - kimi-k2.5:cloud (범용)
 * - qwen3-vl:235b-cloud (비전 특화)
 *
 * @param queryType - 사용자 질문 유형 (code/math/creative/analysis/chat/vision 등)
 * @returns 최적의 A2A 모델 조합 (primary + secondary + synthesizer)
 */
function resolveA2AModels(queryType?: string): A2AModelSelection {
    switch (queryType) {
        case 'code':
            return {
                primary: 'qwen3-coder-next:cloud',
                secondary: 'gpt-oss:120b-cloud',
                synthesizer: 'gemini-3-flash-preview:cloud',
            };
        case 'math':
            return {
                primary: 'gpt-oss:120b-cloud',
                secondary: 'kimi-k2.5:cloud',
                synthesizer: 'gemini-3-flash-preview:cloud',
            };
        case 'creative':
            return {
                primary: 'gpt-oss:120b-cloud',
                secondary: 'kimi-k2.5:cloud',
                synthesizer: 'gemini-3-flash-preview:cloud',
            };
        case 'analysis':
            return {
                primary: 'gpt-oss:120b-cloud',
                secondary: 'qwen3-coder-next:cloud',
                synthesizer: 'gemini-3-flash-preview:cloud',
            };
        case 'chat':
            return {
                primary: 'gemini-3-flash-preview:cloud',
                secondary: 'gpt-oss:120b-cloud',
                synthesizer: 'gemini-3-flash-preview:cloud',
            };
        case 'vision':
            return {
                primary: 'qwen3-vl:235b-cloud',
                secondary: 'gpt-oss:120b-cloud',
                synthesizer: 'gemini-3-flash-preview:cloud',
            };
        default:
            return DEFAULT_A2A_MODELS;
    }
}

/** A2A 합성 모델에 전달되는 시스템 프롬프트 */
const A2A_SYNTHESIS_SYSTEM_PROMPT = [
    '당신은 두 AI 모델의 응답을 종합하여 최고 품질의 최종 답변을 생성하는 전문가입니다.',
    '',
    '## 종합 지침',
    '1. 각 응답에서 가장 강력하고 정확한 포인트를 식별하세요.',
    '2. 모순되는 내용이 있으면 더 정확하고 상세한 쪽을 채택하세요.',
    '3. 양쪽의 보완적 정보를 자연스럽게 결합하세요.',
    '4. 코드 블록, 마크다운 서식, 구조화된 콘텐츠는 그대로 보존하세요.',
    '5. 원본 질문과 동일한 언어로 응답하세요.',
    '',
    '## 출력 형식',
    '최종 종합 답변만 출력하세요. "모델 A에 따르면..." 같은 표현은 사용하지 마세요.',
].join('\n');

/**
 * Agent-to-Agent 병렬 생성 전략
 *
 * Primary와 Secondary 두 모델에 동시에 요청을 보내고,
 * 양쪽 응답이 모두 성공하면 Synthesizer가 종합 답변을 생성합니다.
 * 한쪽만 성공하면 단독 응답을, 양쪽 모두 실패하면 실패를 반환합니다.
 *
 * @class A2AStrategy
 * @implements {ChatStrategy<A2AStrategyContext, A2AStrategyResult>}
 */
export class A2AStrategy implements ChatStrategy<A2AStrategyContext, A2AStrategyResult> {
    /**
     * A2A 병렬 생성을 실행합니다.
     *
     * 실행 흐름:
     * 1. Primary + Secondary 모델에 Promise.allSettled으로 병렬 요청
     * 2. 양쪽 모두 성공 → Synthesizer가 두 응답을 종합
     * 3. 한쪽만 성공 → 단독 응답 사용
     * 4. 양쪽 모두 실패 → succeeded=false 반환
     *
     * @param context - A2A 전략 컨텍스트 (메시지, 옵션, 토큰 콜백)
     * @returns A2A 실행 결과 (응답 텍스트 + 성공 여부)
     * @throws {Error} abortSignal에 의해 중단된 경우 'ABORTED' 에러
     */
    async execute(context: A2AStrategyContext): Promise<A2AStrategyResult> {
        const startTime = Date.now();
        const models = resolveA2AModels(context.queryType);

        const clientA = new OllamaClient({ model: models.primary });
        const clientB = new OllamaClient({ model: models.secondary });

        logger.info(`🔀 A2A 병렬 요청 (queryType=${context.queryType ?? 'default'}): ${models.primary} + ${models.secondary}`);

        // 두 모델에 동시에 요청 (한쪽이 실패해도 다른 쪽 결과를 활용)
        const [resultA, resultB] = await Promise.allSettled([
            clientA.chat(context.messages, context.chatOptions),
            clientB.chat(context.messages, context.chatOptions),
        ]);

        if (context.abortSignal?.aborted) {
            throw new Error('ABORTED');
        }

        // 각 모델의 응답 추출 (실패한 모델은 null)
        const responseA = resultA.status === 'fulfilled' ? resultA.value.content : null;
        const responseB = resultB.status === 'fulfilled' ? resultB.value.content : null;
        const durationParallel = Date.now() - startTime;

        logger.info(`🔀 A2A 병렬 완료 (${durationParallel}ms): ` +
            `${models.primary}=${resultA.status}, ${models.secondary}=${resultB.status}`);

        // 양쪽 모두 실패: succeeded=false를 반환하여 AgentLoop 폴백 트리거
        if (!responseA && !responseB) {
            logger.warn('⚠️ A2A 양쪽 모두 실패');
            if (resultA.status === 'rejected') logger.warn(`  ${models.primary}: ${resultA.reason}`);
            if (resultB.status === 'rejected') logger.warn(`  ${models.secondary}: ${resultB.reason}`);
            return { response: '', succeeded: false };
        }

        // 한쪽만 성공: 성공한 모델의 응답을 단독 사용
        if (!responseA || !responseB) {
            const singleResponse = (responseA || responseB) as string;
            const succeededModel = responseA ? models.primary : models.secondary;
            logger.info(`🔀 A2A 단일 응답 사용: ${succeededModel}`);

            const header = `> 🤖 *${succeededModel} 단독 응답*\n\n`;
            for (const char of header) {
                context.onToken(char);
            }
            for (const char of singleResponse) {
                context.onToken(char);
            }

            return {
                response: header + singleResponse,
                succeeded: true,
            };
        }

        // 양쪽 모두 성공: Synthesizer 모델이 두 응답을 종합하여 최종 답변 생성
        logger.info(`🔀 A2A 종합 합성 시작 (synthesizer: ${models.synthesizer})`);

        // 원본 사용자 질문을 메시지 이력에서 역순 탐색하여 추출
        const userMessage = [...context.messages].reverse().find((m) => m.role === 'user')?.content || '';

        const synthesisUserMessage = [
            '## 원본 질문',
            userMessage,
            '',
            `## Response A (${models.primary})`,
            responseA,
            '',
            `## Response B (${models.secondary})`,
            responseB,
            '',
            '위 두 응답을 종합하여 최고 품질의 최종 답변을 작성해주세요.',
        ].join('\n');

        const synthesizerClient = new OllamaClient({ model: models.synthesizer });
        let fullSynthesis = '';

        const header = `> 🔀 *${models.primary} + ${models.secondary} A2A 종합 답변*\n\n`;
        for (const char of header) {
            context.onToken(char);
        }

        await synthesizerClient.chat(
            [
                { role: 'system', content: A2A_SYNTHESIS_SYSTEM_PROMPT },
                { role: 'user', content: synthesisUserMessage },
            ],
            { temperature: 0.3 },
            (token) => {
                fullSynthesis += token;
                context.onToken(token);
            }
        );

        const totalDuration = Date.now() - startTime;
        logger.info(`✅ A2A 종합 완료: 병렬=${durationParallel}ms, 합성=${totalDuration - durationParallel}ms, 총=${totalDuration}ms`);

        return {
            response: header + fullSynthesis,
            succeeded: true,
        };
    }
}
