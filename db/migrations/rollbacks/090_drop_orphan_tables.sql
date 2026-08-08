-- 090 롤백: 고아 테이블 재생성 (빈 스키마 — 적재 데이터는 전 테이블 0행이었으므로 손실 없음)
-- uir_* 는 db/migrations/012_uir_schema.sql, uploaded_documents 는 구 baseline 정의 참고.
-- canvas_* / agent_marketplace 계열은 생성 소스가 레포에 없던 레거시 스키마라
-- 필요 시 아래 최소 정의로 복원한다 (코드 참조 0 이므로 실사용상 롤백 불필요).

CREATE TABLE IF NOT EXISTS uploaded_documents (
    doc_id TEXT PRIMARY KEY,
    document JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- uir_* 복원이 필요하면 012_uir_schema.sql 을 수동 실행할 것.
-- canvas_documents/canvas_versions/agent_marketplace/agent_installations/agent_reviews 는
-- 참조 코드가 존재하지 않아 별도 복원 정의를 제공하지 않는다.
