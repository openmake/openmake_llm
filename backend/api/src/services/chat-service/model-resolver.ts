/**
 * ============================================================
 * Model Resolver — 쿼리 분류 + 옵션 튜닝
 * ============================================================
 *
 * Decision F (Pure Manual) 적용 후:
 * - **모델 자동 선택은 비활성화** — 사용자가 명시한 모델만 사용
 * - 분류기는 여전히 동작 (caching/관측 + adjustOptionsForModel 의 옵션 튜닝 목적)
 * - 반환되는 selection.model 은 ollamaDefaultModel 로 고정 (Phase 1 단일 모델 환경)
 * - setModel 콜백은 더 이상 호출되지 않음 — OllamaClient.model 은 생성자에서 결정
 *
 * @module services/chat-service/model-resolver
 */
import { createLogger } from '../../utils/logger';
import { selectOptimalModel, type ModelSelection } from '../../chat/model-selector';
import type { ModelOptions } from '../../ollama/types';

const logger = createLogger('ModelResolver');

/**
 * resolveModel 함수의 입력 파라미터.
 *
 * `setModel` 은 Pure Manual 정책 도입 이전의 잔재 — 호출되지 않음.
 * 호출자 코드 호환을 위해 옵셔널로 유지하되, 실제 서명은 무시.
 */
export interface ResolveModelParams {
    /** 사용자 메시지 */
    message: string;
    /** 이미지 포함 여부 */
    hasImages: boolean;
    /** Brand Model 실행 계획 (미사용, 하위 호환용) */
    executionPlan?: unknown;
    /** 프롬프트 설정 (미사용, 하위 호환용) */
    promptConfig?: { options?: ModelOptions };
    /**
     * @deprecated Pure Manual 모드 — 사용자 명시 모델을 override 하지 않으므로 호출되지 않음.
     *   호출자 호환을 위해 옵셔널로 유지.
     */
    setModel?: (model: string) => void;
}

/**
 * 쿼리 분류 + 옵션 튜닝 (Pure Manual: 모델 변경 없음).
 *
 * @param params - 분류·튜닝에 필요한 파라미터
 * @returns 분류 결과 + adjustedOptions (호출자가 ModelOptions 머지에 사용)
 */
export async function resolveModel(params: ResolveModelParams): Promise<ModelSelection> {
    const { message, hasImages } = params;
    const selection = await selectOptimalModel(message, hasImages);
    logger.info(`쿼리 분류: ${selection.queryType} (모델 변경 없음 — Pure Manual)`);
    return selection;
}
