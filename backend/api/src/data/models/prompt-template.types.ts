/**
 * Prompt Template - 엔티티 타입 정의
 *
 * Phase 2.5 Prompt DB Registry 1단계 (스키마 마이그레이션) 의 데이터 계층 타입.
 * SQL: services/database/migrations/013_prompt_templates.sql 참고.
 *
 * @module data/models/prompt-template.types
 */

/**
 * 프롬프트 카테고리 — 라우팅/조회 그룹.
 * 새 카테고리 추가 시 본 union을 확장한다 (DB 컬럼은 VARCHAR(32)이라 임의 값 허용).
 */
export type PromptCategory = 'system' | 'agent' | 'discussion' | string;

/**
 * 활성 프롬프트 템플릿 (prompt_templates 테이블 1행)
 * @interface PromptTemplate
 */
export interface PromptTemplate {
    /** 고유 식별자 (UUID, gen_random_uuid()) */
    id: string;
    /** 템플릿 이름 — 코드에서 룩업하는 키 (UNIQUE) */
    name: string;
    /** 카테고리 ('system', 'agent', 'discussion' 등) */
    category: PromptCategory;
    /** 프롬프트 본문 (현재 활성 버전의 콘텐츠) */
    content: string;
    /** 언어 코드 (예: 'ko', 'en') */
    language: string;
    /** 현재 활성 버전 번호 (1부터 증가) */
    version: number;
    /** 활성 상태 (false면 비활성/은퇴) */
    is_active: boolean;
    /** 최초 생성 시각 (ISO 8601) */
    created_at: string;
    /** 마지막 수정 시각 (ISO 8601) */
    updated_at: string;
}

/**
 * 프롬프트 버전 히스토리 (prompt_template_versions 테이블 1행)
 * @interface PromptTemplateVersion
 */
export interface PromptTemplateVersion {
    /** 고유 식별자 (UUID) */
    id: string;
    /** 템플릿 FK (prompt_templates.id) */
    template_id: string;
    /** 버전 번호 (template_id 내 UNIQUE) */
    version: number;
    /** 해당 버전의 프롬프트 본문 스냅샷 */
    content: string;
    /** 변경자 식별자 (사용자 ID 또는 시스템 식별자, nullable) */
    changed_by: string | null;
    /** 변경 시각 (ISO 8601) */
    changed_at: string;
    /** 변경 사유 (자유 서술, nullable) */
    change_reason: string | null;
}

/**
 * 신규 템플릿 생성 입력
 */
export interface CreatePromptTemplateInput {
    name: string;
    content: string;
    category?: PromptCategory;
    language?: string;
    changedBy?: string;
    changeReason?: string;
}

/**
 * 새 버전 생성 입력 (기존 템플릿 콘텐츠 갱신)
 */
export interface CreateVersionInput {
    templateId: string;
    content: string;
    changedBy?: string;
    changeReason?: string;
}
