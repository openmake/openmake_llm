/**
 * 문서 분석 진행 상태 타입 정의
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

export interface ProgressEvent {
    type: 'document_progress';
    stage: ProgressStage;
    message: string;
    progress?: number;  // 0-100
    filename?: string;
    details?: Record<string, unknown>;
}

export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * 진행 상태 이벤트 생성 헬퍼
 */
export function createProgressEvent(
    stage: ProgressStage,
    message: string,
    filename?: string,
    progress?: number,
    details?: Record<string, unknown>
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
 * 단계별 아이콘 매핑
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
