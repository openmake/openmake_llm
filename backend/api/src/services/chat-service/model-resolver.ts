/**
 * ============================================================
 * Model Resolver — 최적 모델 선택 모듈
 * ============================================================
 *
 * Brand Model auto-routing, Brand Model 직접 매핑, 일반 자동 선택으로
 * 최적 LLM 모델을 결정합니다.
 * ChatService.resolveModel 메서드에서 추출되었습니다.
 *
 * @module services/chat-service/model-resolver
 */
import { createLogger } from '../../utils/logger';
import { selectOptimalModel, type ModelSelection } from '../../chat/model-selector';
import type { ModelOptions } from '../../ollama/types';

const logger = createLogger('ModelResolver');

/**
 * resolveModel 함수의 입력 파라미터
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
    /** 클라이언트 모델 변경 콜백 */
    setModel: (model: string) => void;
}

/**
 * 단일 로컬 모델로 최적 모델을 결정합니다.
 *
 * @param params - 모델 선택에 필요한 파라미터
 * @returns 모델 선택 결과
 */
export async function resolveModel(params: ResolveModelParams): Promise<ModelSelection> {
    const { message, hasImages, setModel } = params;
    const selection = await selectOptimalModel(message, hasImages);
    logger.info(`모델 자동 선택: ${selection.model} (${selection.reason})`);
    setModel(selection.model);
    return selection;
}
