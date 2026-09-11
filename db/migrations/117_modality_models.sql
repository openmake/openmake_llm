-- Migration 117 — modality_models 테이블
--
-- 모달리티(이미지 생성·비전·영상·STT·TTS·임베딩)별 모델 배정 (2026-09-12).
-- "역할&모델"(user_model_roles / global_model_roles — 누가 텍스트 LLM 을 쓰는가)과
-- 별개의 축: 어떤 입출력을 어느 모델이 처리하는가. 텍스트 생성은 이 테이블에 넣지 않는다.
--
-- scope: '__global__'(관리자 전역) 또는 users.id (사용자 오버라이드, BYOK 키 필요).
-- full_id: 'local-llm:<tag>' | '<external_provider>:<model>' — 기존 fullId 규약.
--          외부 provider 는 LLM_GATEWAY_PROVIDERS 에 편입된 것만 허용(호출은 LiteLLM 단일).
-- params: 모달리티별 기본 인자(size·voice·duration 등) JSONB — 코드는 화이트리스트 키만 읽는다.
--
-- 해석 우선순위: 사용자 오버라이드 → 전역 DB → 코드 기본값(config/modality.ts).
-- 구 IMAGE_GEN_MODEL env 는 부팅 시 전역 image_gen 행이 없을 때 1회 시더로만 읽는다
-- (services/modality-resolver.ts seedModalityDefaultsFromEnv) — 다음 배포에서 env 삭제.
--
-- modality CHECK 는 코드 SoT(config/modality.ts MODALITIES)와 정합 유지할 것.

CREATE TABLE IF NOT EXISTS modality_models (
    scope       TEXT NOT NULL,
    modality    TEXT NOT NULL CHECK (modality IN ('image_gen', 'image_edit', 'vision', 'video_gen', 'stt', 'tts', 'embedding')),
    full_id     TEXT NOT NULL,
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, modality)
);

COMMENT ON TABLE modality_models IS
    '모달리티별 모델 배정 — 역할 배정(user_model_roles)과 별개 축. scope=''__global__'' 또는 user_id. 해석은 services/modality-resolver.';
COMMENT ON COLUMN modality_models.full_id IS
    '''local-llm:<tag>'' | ''<provider>:<model>''. 외부는 LLM_GATEWAY_PROVIDERS 편입 provider 만(LiteLLM 단일 호출).';

-- scope 가 '__global__' 도 담아 users FK 를 걸 수 없다 — 사용자 행은 UserManager.deleteUser 가
-- 같은 트랜잭션에서 DELETE 한다.
CREATE INDEX IF NOT EXISTS idx_modality_models_scope ON modality_models (scope);
