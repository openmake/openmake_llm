-- 모델 배정 통합 (2026-09-24) — 역할별 모델(user_model_roles·global_model_roles)과 기능별 모델(capability_models)을
-- 하나의 슬롯 정의·하나의 테이블로 합친다. 겹치던 배정은 한 슬롯이 된다:
--   코드·보안 리뷰 역할(review) + 코드 기능(text.code)  → 'code'
--   딥리서치 역할(research)     + 추론 기능(text.reason) → 'reasoning'
-- 나머지 역할·기능은 같은 이름의 슬롯이다(슬롯 정의는 config/model-slots.ts). 같은 (범위, 슬롯)에 두 값이 있으면
-- 나중에 바꾼 쪽(updated_at)을 남긴다. 옛 세 테이블은 이 배포부터 읽지·쓰지 않고, 다음 배포에서 DROP 한다(2단계 삭제 규칙).

CREATE TABLE IF NOT EXISTS model_assignments (
    scope       TEXT NOT NULL,                  -- '__global__' 또는 사용자 id
    slot        TEXT NOT NULL,
    full_id     TEXT NOT NULL,                  -- provider:model
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope, slot)
);

-- 이관: 기능 배정(범위·파라미터 포함)
INSERT INTO model_assignments (scope, slot, full_id, params, created_at, updated_at)
SELECT scope,
       CASE capability WHEN 'text.code' THEN 'code' WHEN 'text.reason' THEN 'reasoning' ELSE capability END,
       full_id, params, created_at, updated_at
  FROM capability_models
ON CONFLICT (scope, slot) DO UPDATE
   SET full_id = EXCLUDED.full_id, params = EXCLUDED.params, updated_at = EXCLUDED.updated_at
 WHERE EXCLUDED.updated_at > model_assignments.updated_at;

-- 이관: 사용자 역할 배정
INSERT INTO model_assignments (scope, slot, full_id, created_at, updated_at)
SELECT user_id,
       CASE role WHEN 'review' THEN 'code' WHEN 'research' THEN 'reasoning' ELSE role END,
       full_model_id, created_at, updated_at
  FROM user_model_roles
ON CONFLICT (scope, slot) DO UPDATE
   SET full_id = EXCLUDED.full_id, params = '{}'::jsonb, updated_at = EXCLUDED.updated_at
 WHERE EXCLUDED.updated_at > model_assignments.updated_at;

-- 이관: 전역 역할 배정
INSERT INTO model_assignments (scope, slot, full_id, updated_at)
SELECT '__global__',
       CASE role WHEN 'review' THEN 'code' WHEN 'research' THEN 'reasoning' ELSE role END,
       full_model_id, updated_at
  FROM global_model_roles
ON CONFLICT (scope, slot) DO UPDATE
   SET full_id = EXCLUDED.full_id, params = '{}'::jsonb, updated_at = EXCLUDED.updated_at
 WHERE EXCLUDED.updated_at > model_assignments.updated_at;
