import { OllamaClient } from '../../ollama/client';
import type { ChatStrategy, A2AStrategyContext, A2AStrategyResult } from './types';

const A2A_MODELS = {
    primary: 'gpt-oss:120b-cloud',
    secondary: 'gemini-3-flash-preview:cloud',
    synthesizer: 'gemini-3-flash-preview:cloud',
} as const;

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

export class A2AStrategy implements ChatStrategy<A2AStrategyContext, A2AStrategyResult> {
    async execute(context: A2AStrategyContext): Promise<A2AStrategyResult> {
        const startTime = Date.now();

        const clientA = new OllamaClient({ model: A2A_MODELS.primary });
        const clientB = new OllamaClient({ model: A2A_MODELS.secondary });

        console.log(`[ChatService] 🔀 A2A 병렬 요청: ${A2A_MODELS.primary} + ${A2A_MODELS.secondary}`);

        const [resultA, resultB] = await Promise.allSettled([
            clientA.chat(context.messages, context.chatOptions),
            clientB.chat(context.messages, context.chatOptions),
        ]);

        if (context.abortSignal?.aborted) {
            throw new Error('ABORTED');
        }

        const responseA = resultA.status === 'fulfilled' ? resultA.value.content : null;
        const responseB = resultB.status === 'fulfilled' ? resultB.value.content : null;
        const durationParallel = Date.now() - startTime;

        console.log(`[ChatService] 🔀 A2A 병렬 완료 (${durationParallel}ms): ` +
            `${A2A_MODELS.primary}=${resultA.status}, ${A2A_MODELS.secondary}=${resultB.status}`);

        if (!responseA && !responseB) {
            console.warn('[ChatService] ⚠️ A2A 양쪽 모두 실패');
            if (resultA.status === 'rejected') console.warn(`  ${A2A_MODELS.primary}: ${resultA.reason}`);
            if (resultB.status === 'rejected') console.warn(`  ${A2A_MODELS.secondary}: ${resultB.reason}`);
            return { response: '', succeeded: false };
        }

        if (!responseA || !responseB) {
            const singleResponse = (responseA || responseB) as string;
            const succeededModel = responseA ? A2A_MODELS.primary : A2A_MODELS.secondary;
            console.log(`[ChatService] 🔀 A2A 단일 응답 사용: ${succeededModel}`);

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

        console.log(`[ChatService] 🔀 A2A 종합 합성 시작 (synthesizer: ${A2A_MODELS.synthesizer})`);

        const userMessage = [...context.messages].reverse().find((m) => m.role === 'user')?.content || '';

        const synthesisUserMessage = [
            '## 원본 질문',
            userMessage,
            '',
            `## Response A (${A2A_MODELS.primary})`,
            responseA,
            '',
            `## Response B (${A2A_MODELS.secondary})`,
            responseB,
            '',
            '위 두 응답을 종합하여 최고 품질의 최종 답변을 작성해주세요.',
        ].join('\n');

        const synthesizerClient = new OllamaClient({ model: A2A_MODELS.synthesizer });
        let fullSynthesis = '';

        const header = `> 🔀 *${A2A_MODELS.primary} + ${A2A_MODELS.secondary} A2A 종합 답변*\n\n`;
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
        console.log(`[ChatService] ✅ A2A 종합 완료: 병렬=${durationParallel}ms, 합성=${totalDuration - durationParallel}ms, 총=${totalDuration}ms`);

        return {
            response: header + fullSynthesis,
            succeeded: true,
        };
    }
}
