/**
 * ============================================================
 * Document Progress - 문서 분석 진행 상태 타입 정의
 * ============================================================
 *
 * 문서 처리 파이프라인의 각 단계별 진행 상태를 추적하기 위한
 * 타입, 인터페이스, 콜백, 헬퍼 함수를 정의합니다.
 * WebSocket을 통해 클라이언트에 실시간 진행률을 전송하는 데 사용됩니다.
 *
 * @module workers/documents/progress
 * @description 제공하는 타입/함수:
 * - ProgressStage    - 문서 처리 단계 유니온 타입
 * - ProgressEvent    - 진행 상태 이벤트 인터페이스
 * - ProgressCallback - 진행 상태 콜백 타입
 * - createProgressEvent() - 진행 상태 이벤트 생성 헬퍼
 * - STAGE_ICONS      - 단계별 아이콘 매핑 상수
 */

/**
 * 문서 처리 파이프라인의 단계를 나타내는 유니온 타입
 * upload -> extract -> (pdf_parse | ocr_* | excel_parse | image_ocr | text_read) -> complete | error
 */
export type ProgressStage =
    | 'upload'
    | 'extract'
    | 'pdf_parse'
    | 'ocr_prepare'
    | 'ocr_convert'
    | 'ocr_recognize'
    | 'ocr_complete'
    | 'excel_parse'
    | 'image_ocr'
    | 'text_read'
    | 'complete'
    | 'error';

/**
 * 문서 처리 진행 상태 이벤트 인터페이스
 * WebSocket을 통해 클라이언트에 전송되는 진행 상태 메시지입니다.
 * @property type - 이벤트 타입 (항상 'document_progress')
 * @property stage - 현재 처리 단계
 * @property message - 사용자에게 표시할 진행 메시지
 * @property progress - 진행률 (0-100, 선택)
 * @property filename - 처리 중인 파일명 (선택)
 * @property details - 추가 상세 정보 (선택)
 */
export interface ProgressEvent {
    type: 'document_progress';
    stage: ProgressStage;
    message: string;
    progress?: number;  // 0-100
    filename?: string;
    details?: Record<string, any>;
}

/** 진행 상태 이벤트를 수신하는 콜백 함수 타입 */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * ProgressEvent 객체를 생성하는 헬퍼 함수입니다.
 * @param stage - 현재 처리 단계
 * @param message - 진행 메시지
 * @param filename - 처리 중인 파일명 (선택)
 * @param progress - 진행률 0-100 (선택)
 * @param details - 추가 상세 정보 (선택)
 * @returns ProgressEvent 객체
 */
export function createProgressEvent(
    stage: ProgressStage,
    message: string,
    filename?: string,
    progress?: number,
    details?: Record<string, any>
): ProgressEvent {
    return {
        type: 'document_progress',
        stage,
        message,
        filename,
        progress,
        details
    };
}

/**
 * 각 처리 단계에 대응하는 UI 아이콘 매핑 상수
 * 클라이언트에서 진행 상태 표시 시 사용됩니다.
 */
export const STAGE_ICONS: Record<ProgressStage, string> = {
    'upload': '📤',
    'extract': '📋',
    'pdf_parse': '📄',
    'ocr_prepare': '🔧',
    'ocr_convert': '🖼️',
    'ocr_recognize': '🔍',
    'ocr_complete': '✅',
    'excel_parse': '📊',
    'image_ocr': '🖼️',
    'text_read': '📝',
    'complete': '✅',
    'error': '❌'
};
