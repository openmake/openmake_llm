/**
 * ============================================================
 * Model Resolver — 쿼리 분류 + 옵션 튜닝
 * ============================================================
 *
 * Decision F (Pure Manual) 적용 후:
 * - **모델 자동 선택은 비활성화** — 사용자가 명시한 모델만 사용
 * - 분류기는 여전히 동작 (caching/관측 + adjustOptionsForModel 의 옵션 튜닝 목적)
 * - 반환되는 selection.model 은 llmDefaultModel 로 고정 (Phase 1 단일 모델 환경)
 *
 * @module services/chat-service/model-resolver
 */
import { createLogger } from '../../utils/logger';
import { selectOptimalModel, type ModelSelection } from '../../chat/model-selector';

const logger = createLogger('ModelResolver');

/**
 * resolveModel 함수의 입력 파라미터.
 *
 * 변경 이력 (2026-05-19): setModel / executionPlan / promptConfig 의 dead 필드 제거.
 * ChatService.resolveModel(line 663) 이 setModel 을 전달하지 않으며, executionPlan /
 * promptConfig 도 함수 본문에서 사용되지 않음 (Pure Manual 모드 도입 이후 잔재).
 */
export interface ResolveModelParams {
    /** 사용자 메시지 */
    message: string;
    /** 이미지 포함 여부 */
    hasImages: boolean;
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
