-- 061: routing_shadow_decisions — Tail 라우팅 게이트 셰도우 로그.
--
-- 배경: 채팅 답변 품질용 verify/loop 를 "모든 복잡질문"이 아니라 "모델이 틀릴 법하고(errorScore)
--   외부로 검증 가능한(verifiability)" 소수(tail)에만 태우기로 결정(A/B 실측 근거). 그 게이트를
--   실제로 켜기 전에, 결정만 계산·적재해 분포를 실측하는 셰도우 모드의 저장소.
--   TAIL_ROUTING_SHADOW_ENABLED=true 일 때만 적재하며 실행 경로는 바꾸지 않는다(사용자 영향 0).
--
-- 캘리브레이션: a_was_correct / grounding_fixed 는 향후 (b) 하네스 실측이 채우는 라벨 컬럼 —
--   게이트 정밀도(FP/FN)와 각 피처의 실제 실패예측력(Q4)을 지도학습하는 근거.
--
-- 멱등: CREATE TABLE/INDEX IF NOT EXISTS. users.id 는 TEXT (프로젝트 관행), ON DELETE SET NULL.

CREATE TABLE IF NOT EXISTS routing_shadow_decisions (
    id              BIGSERIAL PRIMARY KEY,
    request_id      TEXT,
    user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 분류 피처
    query_type      TEXT,
    confidence      REAL,
    query_length    INT,

    -- 축 A (오류 가능성)
    error_score     REAL,
    error_signals   JSONB,

    -- 축 B (검증 가능성)
    verifiability   TEXT,

    -- 게이트 결정 (셰도우: 로깅만, 실행 무변경)
    is_tail         BOOLEAN,
    would_route_to  TEXT,

    -- 사후 캘리브레이션 라벨 ((b) 하네스가 채움)
    a_was_correct   BOOLEAN,
    grounding_fired BOOLEAN,
    grounding_fixed BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_rsd_created ON routing_shadow_decisions (created_at);
CREATE INDEX IF NOT EXISTS idx_rsd_tail_verif ON routing_shadow_decisions (is_tail, verifiability);
