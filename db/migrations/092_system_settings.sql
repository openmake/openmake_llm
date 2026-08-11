-- 092: system_settings — 운영 설정 DB 이관 (admin UI 관리, env 폴백)
--
-- 배경: curl/npm 패키지 배포 로드맵 — 설치 후 .env 수동 편집 없이 관리자 화면에서
-- 운영 설정(OAuth/검색/알림/푸시/LLM 게이트웨이)을 입력/변경한다.
-- 해석 우선순위는 DB > env > 기본값 (config/env.ts applySettingsOverlay).
-- 허용 키 화이트리스트는 config/system-settings-registry.ts (임의 키 저장 금지).
-- 민감 키(is_secret=true)의 value 는 utils/token-crypto (AES-256-GCM, v1: prefix) 암호문.

CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    is_secret   BOOLEAN NOT NULL DEFAULT false,
    updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_settings IS '운영 설정 key-value. 우선순위 DB > env > 기본값. 허용 키는 config/system-settings-registry.ts';
COMMENT ON COLUMN system_settings.key IS 'env 변수명과 동일한 설정 키 (registry 화이트리스트 내)';
COMMENT ON COLUMN system_settings.value IS 'is_secret=true 면 v1: AES-256-GCM 암호문, 아니면 평문';
