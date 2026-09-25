-- Knowledge Space 지침(instructions) — Space 소유자가 그 Space 대화에 매 턴 주입할 안내문(2026-09-25).
-- 네임스페이스 addon:knowledge-runtime:002. 멱등(IF NOT EXISTS · jsonb 는 없을 때만 채운다).
--
-- 정책값(주입 토큰 예산 maxInstructionTokens)은 코드 상수가 아니라 knowledge_profiles.limits 의 데이터다.
-- 코드는 이 키가 없어도 명명 상수(config/injection.ts)로 폴백한다 — 여기서는 기본 프로필에 값을 심기만 한다.

ALTER TABLE knowledge_spaces ADD COLUMN IF NOT EXISTS instructions TEXT;

-- limits 프로필에 주입 예산 키를 없을 때만 추가한다(관리자가 이미 바꾼 값은 건드리지 않는다).
UPDATE knowledge_profiles
SET config = config || jsonb_build_object('maxInstructionTokens', 2000)
WHERE kind = 'limits' AND NOT (config ? 'maxInstructionTokens');
