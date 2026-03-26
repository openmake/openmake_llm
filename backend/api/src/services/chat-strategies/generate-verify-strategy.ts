/**
 * ============================================================
 * GenerateVerifyStrategy - 생성-검증 전략
 * ============================================================
 *
 * Generator(강력 모델)가 1차 응답을 생성하고,
 * Verifier(다른 강력 모델)가 팩트체크·논리검증·보완을 수행합니다.
 *
 * 2 API 호출(Generator + Verifier)로
 * 높은 품질과 교차 검증 효과를 제공합니다.
 *
 * @module services/chat-strategies/generate-verify-strategy
 * @description
 * - Generator: 내부 버퍼링 (사용자에게 스트리밍하지 않음)
 * - Verifier: 검증된 최종 답변을 스트리밍
 * - Generator 실패 → succeeded=false (AgentLoop 폴백)
 * - Verifier 실패 → Generator 응답을 그대로 스트리밍 (graceful degradation)
 *
 * @see config/model-defaults.ts - GV_MODEL_MAP
 * @see prompts/verifier-system.ts - Verifier 시스템 프롬프트
 */
import { OllamaClient } from '../../ollama/client';
import type { ChatStrategy, GenerateVerifyStrategyContext, GenerateVerifyStrategyResult } from './types';
import { createLogger } from '../../utils/logger';
import { resolvePromptLocale } from '../../chat/language-policy';
import { VERIFIER_SYSTEM_PROMPTS, VERIFIER_LABELS, GV_HEADERS } from '../../prompts/verifier-system';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';

const logger = createLogger('GenerateVerifyStrategy');

/**
 * Generate-Verify 전략 클래스
 *
 * 실행 흐름:
 * 1. Generator 모델에 요청 → 1차 응답 내부 버퍼링
 * 2. Verifier 모델에 검증 요청 → 최종 답변 스트리밍
 * 3. 에러 핸들링:
 *    - Generator 실패 → succeeded=false (AgentLoop 폴백)
 *    - Verifier 실패 → Generator 응답 그대로 사용 (graceful degradation)
 */
export class GenerateVerifyStrategy
    implements ChatStrategy<GenerateVerifyStrategyContext, GenerateVerifyStrategyResult> {

    async execute(context: GenerateVerifyStrategyContext): Promise<GenerateVerifyStrategyResult> {
        const startTime = Date.now();

        logger.info(
            `🔍 GV 시작 (queryType=${context.queryType ?? 'default'}): ` +
            `generator=${context.generatorModel}, verifier=${context.verifierModel}`
        );

        // ── Step 1: Generator — 1차 응답 생성 (내부 버퍼링) ──
        const generatorClient = new OllamaClient({ model: context.generatorModel });
        let generatedResponse: string;

        try {
            if (context.abortSignal?.aborted) {
                throw new Error('ABORTED');
            }

            const generatorResult = await generatorClient.chat(
                context.messages,
                context.chatOptions,
            );
            generatedResponse = generatorResult.content;

            if (!generatedResponse || generatedResponse.trim().length === 0) {
                logger.warn('⚠️ GV Generator 빈 응답');
                return { response: '', succeeded: false, verified: false, issuesFound: 0 };
            }

            const genDuration = Date.now() - startTime;
            logger.info(`🔍 GV Generator 완료 (${genDuration}ms): ${context.generatorModel}`);

        } catch (e) {
            if (e instanceof Error && e.message === 'ABORTED') throw e;
            logger.warn('⚠️ GV Generator 실패, AgentLoop 폴백:', e instanceof Error ? e.message : e);
            return { response: '', succeeded: false, verified: false, issuesFound: 0 };
        }

        if (context.abortSignal?.aborted) {
            throw new Error('ABORTED');
        }

        // ── Step 2: Verifier — 팩트체크 + 논리검증 + 보완 ──
        const locale = resolvePromptLocale(context.userLanguage || 'en');
        const labels = VERIFIER_LABELS[locale];
        const headers = GV_HEADERS[locale];

        // 원본 사용자 질문을 메시지 이력에서 역순 탐색하여 추출
        const userMessage = [...context.messages].reverse()
            .find((m) => m.role === 'user')?.content || '';

        const verificationUserMessage = [
            labels.originalQuestion,
            userMessage,
            '',
            labels.generatedResponse,
            generatedResponse,
            '',
            labels.verificationRequest,
        ].join('\n');

        const verifierClient = new OllamaClient({ model: context.verifierModel });
        let fullVerifiedResponse = '';

        // format 지정 시 temperature: 0 적용 (Ollama 공식 문서 권장)
        const verifierOptions = context.format
            ? { temperature: LLM_TEMPERATURES.FORMAT_STRICT }
            : { temperature: LLM_TEMPERATURES.GV_VERIFIER };

        // 스트리밍 헤더 전송
        const header = `> ✅ *${context.generatorModel} → ${context.verifierModel} ${headers.verified}*\n\n`;
        for (const char of header) {
            context.onToken(char);
        }

        try {
            await verifierClient.chat(
                [
                    { role: 'system', content: VERIFIER_SYSTEM_PROMPTS[locale] },
                    { role: 'user', content: verificationUserMessage },
                ],
                verifierOptions,
                (token, thinking) => {
                    if (thinking) {
                        context.onToken('', thinking);
                        return;
                    }
                    fullVerifiedResponse += token;
                    context.onToken(token);
                },
                {
                    ...(context.format && { format: context.format }),
                }
            );

            const totalDuration = Date.now() - startTime;
            logger.info(
                `✅ GV 검증 완료: 총=${totalDuration}ms`
            );

            return {
                response: header + fullVerifiedResponse,
                succeeded: true,
                verified: true,
                issuesFound: 0,
            };

        } catch (e) {
            if (e instanceof Error && e.message === 'ABORTED') throw e;

            // Verifier 실패 → Generator 응답 그대로 사용 (graceful degradation)
            // succeeded=true를 유지하여 AgentLoop 폴백을 방지하되, verified=false로 미검증 표시
            logger.warn(
                `⚠️ GV Verifier 실패 (${context.verifierModel}), Generator 응답으로 폴백:`,
                e instanceof Error ? e.message : e
            );

            // Generator 응답을 스트리밍
            const fallbackHeader = `> 🤖 *${context.generatorModel} ${headers.single}*\n\n`;
            for (const char of fallbackHeader) {
                context.onToken(char);
            }
            for (const char of generatedResponse) {
                context.onToken(char);
            }

            return {
                response: fallbackHeader + generatedResponse,
                succeeded: true,
                verified: false,
                issuesFound: 0,
            };
        }
    }
}
