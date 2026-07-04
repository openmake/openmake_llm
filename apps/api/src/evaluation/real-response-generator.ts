/**
 * ============================================================
 * Real Response Generator — ChatService 실제 호출 래퍼
 * ============================================================
 *
 * mock generator(--mock)와 동일한 ResponseGenerator 시그니처를 만족하면서
 * 실제 ChatService.processMessage를 호출하여 응답을 생성합니다.
 *
 * **운영 사고 방지 가드 (4중)**:
 * 1) `--real` 명시적 플래그가 있어야만 활성 (기본은 `--mock`)
 * 2) `--limit N` (또는 `OMK_EVAL_REAL_DEFAULT_LIMIT`, 기본 5)으로 케이스 수 제한
 * 3) 케이스당 timeoutMs (기본 60s) — 초과 시 AbortController로 중단
 * 4) 케이스당 maxTokensPerCase (기본 2000) — 누적 추정 초과 시 즉시 abort
 *
 * **설계 결정**:
 * - **ChatService 인스턴스는 케이스마다 새로 생성**합니다.
 *   ChatService는 `currentUserContext`, `currentEnabledTools` 등 인스턴스 상태를
 *   `setUserContext`로 매 호출 시작에 덮어쓰지만, 평가 환경에서는 케이스 간
 *   완전한 격리를 위해 매번 fresh 인스턴스를 사용합니다 (advisor 권고).
 *
 * - **Timeout은 AbortController + req.abortSignal로 전파**합니다.
 *   ChatService 내부 `checkAborted()`가 'ABORTED' throw → catch 후 명확한
 *   timeout/budget 메시지로 재throw. ChatService를 직접 수정하지 않습니다.
 *
 * - **토큰 누적은 onToken 콜백 char 누적의 보수적 추정**입니다.
 *   ChatService는 정확한 토큰 카운트(prompt_tokens/completion_tokens)를 외부
 *   ResponseGenerator로 노출하지 않으므로, onToken으로 흐르는 응답 chunk의
 *   문자 수를 누적하고 `chars / 3`을 토큰 추정값으로 사용합니다.
 *   - 영문: ~4 char/token (실제 토큰 수보다 estimate가 큼 → 더 일찍 abort)
 *   - 한글/코드: 토크나이저 별로 변동. /3은 보수적(early-abort) 방향.
 *   이는 비용 가드용 휴리스틱이지 정확한 측정이 아닙니다.
 *
 * @module evaluation/real-response-generator
 */
import { LLMClient } from '../llm';
import { ChatService } from '../services/ChatService';
import { createLogger } from '../utils/logger';
import type { ChatMessageRequest } from '../services/chat-service-types';
import type { ResponseGenerator } from './response-evaluator';

const logger = createLogger('RealResponseGenerator');

/**
 * 토큰 누적 추정 분모 — chars / TOKEN_ESTIMATION_DIVISOR.
 * /3은 영문 평균(4)보다 작아서 추정값이 크게 나오고, 더 빨리 abort 됩니다 (안전 측면).
 */
const TOKEN_ESTIMATION_DIVISOR = 3;

/** createRealResponseGenerator 옵션 */
export interface RealResponseGeneratorOptions {
    /** LLM 클라이언트 (미지정 시 환경변수 기반 기본 클라이언트 생성) */
    llmClient?: LLMClient;
    /** 케이스당 최대 실행 시간 (ms). 기본 60_000 */
    timeoutMs?: number;
    /** 케이스당 최대 추정 토큰. 기본 2000 */
    maxTokensPerCase?: number;
    /** 토큰 한도 초과 시 즉시 abort + throw할지. 기본 true */
    abortOnBudgetExceed?: boolean;
    /** ChatService 인스턴스를 외부에서 주입 (테스트용). 미지정 시 매 호출마다 new */
    chatServiceFactory?: (client: LLMClient) => ChatService;
}

/** 응답 생성 중 가드 트리거를 식별하기 위한 Error 서브타입 */
export class EvalGuardError extends Error {
    constructor(
        public readonly guard: 'timeout' | 'token-budget',
        message: string,
        public readonly stats: { durationMs: number; estimatedTokens: number; chars: number },
    ) {
        super(message);
        this.name = 'EvalGuardError';
    }
}

/**
 * Real ResponseGenerator 팩토리.
 *
 * 반환된 함수는 (query, language?) => Promise<string> 시그니처로,
 * 호출 시마다 ChatService를 통해 실제 LLM 응답을 생성합니다.
 *
 * 주의: --real 모드는 LLM 비용을 발생시킵니다. 반드시 --limit과 함께 쓰세요.
 */
export function createRealResponseGenerator(
    options: RealResponseGeneratorOptions = {},
): ResponseGenerator {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const maxTokens = options.maxTokensPerCase ?? 2000;
    const abortOnBudgetExceed = options.abortOnBudgetExceed ?? true;
    const factory = options.chatServiceFactory ?? ((c) => new ChatService(c));

    return async (query, language) => {
        // 케이스 간 상태 누수 방지: client/service를 새로 생성
        const client = options.llmClient ?? new LLMClient({});
        const chatService = factory(client);

        // 단일 AbortController로 timeout + token-budget 두 가드를 모두 처리
        const controller = new AbortController();
        let triggeredGuard: 'timeout' | 'token-budget' | null = null;

        const timeoutHandle = setTimeout(() => {
            if (!controller.signal.aborted) {
                triggeredGuard = 'timeout';
                controller.abort();
            }
        }, timeoutMs);

        let chars = 0;
        const startedAt = Date.now();

        const onToken = (token: string): void => {
            // 메모리 주의: 긴 응답을 buffer하지 않고 카운터만 유지
            // (token-budget 가드는 chars만으로 충분; 실제 응답은 processMessage 반환값에서 받음)
            chars += token.length;
            if (abortOnBudgetExceed) {
                const estimated = Math.ceil(chars / TOKEN_ESTIMATION_DIVISOR);
                if (estimated > maxTokens && !controller.signal.aborted) {
                    triggeredGuard = 'token-budget';
                    controller.abort();
                }
            }
        };

        const req: ChatMessageRequest = {
            message: query,
            history: [],
            userId: 'eval-real-runner',
            userRole: 'user',
            // ChatService가 내장 MCP 도구를 활성화하지 않도록 빈 객체 전달
            // (apiKeyId 없이 enabledTools 미지정이면 전체 허용 → 평가 비용 폭증 위험)
            enabledTools: {},
            abortSignal: controller.signal,
            userLanguagePreference: language,
        };

        logger.info(
            `[real-eval] case start: query="${query.slice(0, 60)}${query.length > 60 ? '...' : ''}", ` +
            `timeoutMs=${timeoutMs}, maxTokens=${maxTokens}`,
        );

        try {
            const response = await chatService.processMessage(req, onToken);

            const durationMs = Date.now() - startedAt;
            const estimatedTokens = Math.ceil(chars / TOKEN_ESTIMATION_DIVISOR);
            logger.info(
                `[real-eval] case ok: durationMs=${durationMs}, chars=${chars}, ` +
                `estTokens=${estimatedTokens}, responseLen=${response.length}`,
            );
            return response;
        } catch (e) {
            const durationMs = Date.now() - startedAt;
            const estimatedTokens = Math.ceil(chars / TOKEN_ESTIMATION_DIVISOR);
            const stats = { durationMs, estimatedTokens, chars };

            // ChatService는 abort 시 'ABORTED' throw → 어떤 가드가 트리거했는지 식별해 재throw
            const errMsg = e instanceof Error ? e.message : String(e);
            if (triggeredGuard === 'timeout' || (controller.signal.aborted && errMsg === 'ABORTED' && triggeredGuard === null)) {
                logger.warn(
                    `[real-eval] case TIMEOUT after ${durationMs}ms ` +
                    `(estTokens=${estimatedTokens}, chars=${chars})`,
                );
                throw new EvalGuardError(
                    'timeout',
                    `응답이 ${timeoutMs}ms 안에 완료되지 않아 중단됨 (chars=${chars}, estTokens=${estimatedTokens})`,
                    stats,
                );
            }
            if (triggeredGuard === 'token-budget') {
                logger.warn(
                    `[real-eval] case TOKEN-BUDGET exceeded ` +
                    `(estTokens=${estimatedTokens} > ${maxTokens}, chars=${chars}, durationMs=${durationMs})`,
                );
                throw new EvalGuardError(
                    'token-budget',
                    `토큰 추정값이 한도를 초과하여 중단됨 (estTokens=${estimatedTokens} > maxTokens=${maxTokens})`,
                    stats,
                );
            }

            logger.warn(
                `[real-eval] case FAILED durationMs=${durationMs}, chars=${chars}, error=${errMsg}`,
            );
            throw e;
        } finally {
            clearTimeout(timeoutHandle);
        }
    };
}
