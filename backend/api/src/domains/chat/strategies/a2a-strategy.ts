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
import { OllamaClient } from '../../../ollama/client';
import type { ChatStrategy, A2AStrategyContext, A2AStrategyResult } from './types';
import { createLogger } from '../../../utils/logger';
import { getConfig } from '../../../config/env';
import { logA2AModelSelection } from '../pipeline/routing-logger';
import { resolvePromptLocale, type PromptLocaleCode } from '../pipeline/language-policy';

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
 * env.ts의 OMK_ENGINE_* 설정에서 런타임에 모델명을 resolve합니다.
 */
function getDefaultA2AModels(): A2AModelSelection {
    const config = getConfig();
    return {
        primary: config.omkEngineLlm,
        secondary: config.omkEngineFast,
        synthesizer: config.omkEngineFast,
    };
}

/**
 * 질문 유형(QueryType)에 따라 최적의 A2A 모델 조합을 선택합니다.
 *
 * env.ts의 OMK_ENGINE_* 설정에서 런타임에 모델명을 resolve합니다.
 *
 * @param queryType - 사용자 질문 유형 (code/math/creative/analysis/chat/vision 등)
 * @returns 최적의 A2A 모델 조합 (primary + secondary + synthesizer)
 */
function resolveA2AModels(queryType?: string): A2AModelSelection {
    const config = getConfig();

    switch (queryType) {
        case 'code':
            return {
                primary: config.omkEngineCode,
                secondary: config.omkEngineLlm,
                synthesizer: config.omkEngineFast,
            };
        case 'math':
            return {
                primary: config.omkEngineLlm,
                secondary: config.omkEnginePro,
                synthesizer: config.omkEngineFast,
            };
        case 'creative':
            return {
                primary: config.omkEngineLlm,
                secondary: config.omkEnginePro,
                synthesizer: config.omkEngineFast,
            };
        case 'analysis':
            return {
                primary: config.omkEngineLlm,
                secondary: config.omkEngineCode,
                synthesizer: config.omkEngineFast,
            };
        case 'chat':
            return {
                primary: config.omkEngineFast,
                secondary: config.omkEngineLlm,
                synthesizer: config.omkEngineFast,
            };
        case 'vision':
            return {
                primary: config.omkEngineVision,
                secondary: config.omkEngineLlm,
                synthesizer: config.omkEngineFast,
            };
        default:
            return getDefaultA2AModels();
    }
}

/** A2A 합성 모델에 전달되는 시스템 프롬프트 (6개 언어) */
const A2A_SYNTHESIS_SYSTEM_PROMPTS: Record<PromptLocaleCode, string> = {
    ko: [
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
    ].join('\n'),
    en: [
        'You are an expert who synthesizes responses from two AI models to produce the highest quality final answer.',
        '',
        '## Synthesis Guidelines',
        '1. Identify the strongest and most accurate points from each response.',
        '2. When there are contradictions, adopt the more accurate and detailed side.',
        '3. Naturally combine complementary information from both sides.',
        '4. Preserve code blocks, markdown formatting, and structured content as-is.',
        '5. Respond in the same language as the original question.',
        '',
        '## Output Format',
        'Output only the final synthesized answer. Do not use expressions like "According to Model A...".',
    ].join('\n'),
    ja: [
        'あなたは2つのAIモデルの応答を統合し、最高品質の最終回答を生成する専門家です。',
        '',
        '## 統合ガイドライン',
        '1. 各応答から最も強力で正確なポイントを特定してください。',
        '2. 矛盾がある場合は、より正確で詳細な方を採用してください。',
        '3. 両方の補完的な情報を自然に結合してください。',
        '4. コードブロック、マークダウン書式、構造化コンテンツはそのまま保持してください。',
        '5. 元の質問と同じ言語で応答してください。',
        '',
        '## 出力形式',
        '最終的な統合回答のみを出力してください。「モデルAによると…」のような表現は使用しないでください。',
    ].join('\n'),
    zh: [
        '你是一位综合两个AI模型响应以生成最高质量最终答案的专家。',
        '',
        '## 综合指南',
        '1. 从每个响应中识别最有力和最准确的要点。',
        '2. 如有矛盾，采用更准确、更详细的一方。',
        '3. 自然地结合双方的互补信息。',
        '4. 保留代码块、Markdown格式和结构化内容。',
        '5. 用与原始问题相同的语言回答。',
        '',
        '## 输出格式',
        '仅输出最终综合答案。不要使用"根据模型A..."之类的表达。',
    ].join('\n'),
    es: [
        'Eres un experto que sintetiza respuestas de dos modelos de IA para producir la respuesta final de mayor calidad.',
        '',
        '## Directrices de síntesis',
        '1. Identifica los puntos más fuertes y precisos de cada respuesta.',
        '2. Cuando haya contradicciones, adopta el lado más preciso y detallado.',
        '3. Combina naturalmente la información complementaria de ambas partes.',
        '4. Preserva los bloques de código, el formato markdown y el contenido estructurado tal cual.',
        '5. Responde en el mismo idioma que la pregunta original.',
        '',
        '## Formato de salida',
        'Genera solo la respuesta final sintetizada. No uses expresiones como "Según el Modelo A...".',
    ].join('\n'),
    de: [
        'Sie sind ein Experte, der Antworten von zwei KI-Modellen zusammenfasst, um die qualitativ hochwertigste endgültige Antwort zu erstellen.',
        '',
        '## Syntheserichtlinien',
        '1. Identifizieren Sie die stärksten und genauesten Punkte aus jeder Antwort.',
        '2. Bei Widersprüchen übernehmen Sie die genauere und detailliertere Seite.',
        '3. Kombinieren Sie ergänzende Informationen beider Seiten natürlich.',
        '4. Bewahren Sie Codeblöcke, Markdown-Formatierung und strukturierte Inhalte unverändert.',
        '5. Antworten Sie in derselben Sprache wie die ursprüngliche Frage.',
        '',
        '## Ausgabeformat',
        'Geben Sie nur die endgültige zusammengefasste Antwort aus. Verwenden Sie keine Ausdrücke wie "Laut Modell A...".',
    ].join('\n'),
    fr: [
        'Vous êtes un expert qui synthétise les réponses de deux modèles d\'IA pour produire la réponse finale de la plus haute qualité.',
        '',
        '## Directives de synthèse',
        '1. Identifiez les points les plus forts et les plus précis de chaque réponse.',
        '2. En cas de contradictions, adoptez le côté le plus précis et le plus détaillé.',
        '3. Combinez naturellement les informations complémentaires des deux parties.',
        '4. Préservez les blocs de code, la mise en forme markdown et le contenu structuré tels quels.',
        '5. Répondez dans la même langue que la question originale.',
        '',
        '## Format de sortie',
        'Produisez uniquement la réponse finale synthétisée. N\'utilisez pas d\'expressions comme « Selon le Modèle A... ».',
    ].join('\n'),
};

/** A2A 합성 메시지 레이블 (6개 언어) */
const A2A_SYNTHESIS_LABELS: Record<PromptLocaleCode, { originalQuestion: string; synthesisRequest: string }> = {
    ko: { originalQuestion: '## 원본 질문', synthesisRequest: '위 두 응답을 종합하여 최고 품질의 최종 답변을 작성해주세요.' },
    en: { originalQuestion: '## Original Question', synthesisRequest: 'Please synthesize the two responses above into the highest quality final answer.' },
    ja: { originalQuestion: '## 元の質問', synthesisRequest: '上記2つの応答を統合し、最高品質の最終回答を作成してください。' },
    zh: { originalQuestion: '## 原始问题', synthesisRequest: '请综合以上两个响应，撰写最高质量的最终答案。' },
    es: { originalQuestion: '## Pregunta original', synthesisRequest: 'Por favor, sintetiza las dos respuestas anteriores en la respuesta final de mayor calidad.' },
    de: { originalQuestion: '## Ursprüngliche Frage', synthesisRequest: 'Bitte fassen Sie die beiden obigen Antworten zu einer endgültigen Antwort höchster Qualität zusammen.' },
    fr: { originalQuestion: '## Question originale', synthesisRequest: 'Veuillez synthétiser les deux réponses ci-dessus en une réponse finale de la plus haute qualité.' },
};

/** A2A 헤더 문자열 (6개 언어) */
const A2A_HEADERS: Record<PromptLocaleCode, { solo: string; synthesis: string }> = {
    ko: { solo: '단독 응답', synthesis: 'A2A 종합 답변' },
    en: { solo: 'Solo Response', synthesis: 'A2A Synthesized Answer' },
    ja: { solo: '単独応答', synthesis: 'A2A 統合回答' },
    zh: { solo: '单独响应', synthesis: 'A2A 综合回答' },
    es: { solo: 'Respuesta individual', synthesis: 'Respuesta sintetizada A2A' },
    de: { solo: 'Einzelantwort', synthesis: 'A2A-Syntheseantwort' },
    fr: { solo: 'Réponse individuelle', synthesis: 'Réponse synthétisée A2A' },
};

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
        logA2AModelSelection(context.queryType || 'default', models.primary, models.secondary, models.synthesizer);

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

            const locale = resolvePromptLocale(context.userLanguage || 'en');
            const headers = A2A_HEADERS[locale];
            const header = `> 🤖 *${succeededModel} ${headers.solo}*\n\n`;
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

        const locale = resolvePromptLocale(context.userLanguage || 'en');
        const labels = A2A_SYNTHESIS_LABELS[locale];

        const synthesisUserMessage = [
            labels.originalQuestion,
            userMessage,
            '',
            `## Response A (${models.primary})`,
            responseA,
            '',
            `## Response B (${models.secondary})`,
            responseB,
            '',
            labels.synthesisRequest,
        ].join('\n');

        const synthesizerClient = new OllamaClient({ model: models.synthesizer });
        let fullSynthesis = '';

        const headers = A2A_HEADERS[locale];
        const header = `> 🔀 *${models.primary} + ${models.secondary} ${headers.synthesis}*\n\n`;
        for (const char of header) {
            context.onToken(char);
        }

        await synthesizerClient.chat(
            [
                { role: 'system', content: A2A_SYNTHESIS_SYSTEM_PROMPTS[locale] },
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
