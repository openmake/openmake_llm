-- 083: 외부 provider 모델의 실사용 가능 여부 기록
--
-- 배경: provider 의 /v1/models 는 계정 권한과 무관하게 전체 카탈로그를 반환한다.
-- 실측(2026-07-26) — Ollama Cloud 18종 중 10종이 403 "requires a subscription",
-- NVIDIA 무료티어는 계정별 404. 모델 셀렉터에는 다 보이는데 고르면 실패한다.
--
-- 이 테이블은 (사용자, provider, 모델) 단위로 "실제로 호출 가능한가"를 기록해
-- 목록에서 걸러낸다. 채워지는 경로는 두 가지 — ① 실제 호출 실패 시 자동 학습
-- ② 프로브 API 로 카탈로그 일괄 점검.

CREATE TABLE IF NOT EXISTS external_model_availability (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id VARCHAR(64) NOT NULL,
    model_id    TEXT NOT NULL,
    -- false = 목록에서 제외 대상
    usable      BOOLEAN NOT NULL,
    -- 판정 근거 (업스트림 상태/메시지 요약) — 운영 진단용
    reason      TEXT,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider_id, model_id)
);

-- 목록 필터가 (user, provider) 로 전량 조회 → 커버링 인덱스
CREATE INDEX IF NOT EXISTS idx_ext_model_avail_lookup
    ON external_model_availability (user_id, provider_id)
    WHERE usable = FALSE;
