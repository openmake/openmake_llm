---
version: "1.0"
effective_date: "2026-05-24"
locale: ko
---

# 개인정보 처리방침 (초안)

> ⚠️ **본 문서는 Claude 가 작성한 초안입니다.** 법무 검토 후 최종 게시 예정.
> 운영자가 실서비스 배포 전 반드시 법률 자문을 받으세요.

OpenMake LLM (이하 "서비스") 는 사용자의 개인정보를 다음과 같이 처리합니다.

## 1. 수집하는 개인정보

회원가입 및 서비스 이용 과정에서 다음 정보를 수집합니다.

| 항목 | 수집 시점 | 필수 여부 |
|------|----------|----------|
| 사용자명 (username) | 회원가입 | 필수 |
| 이메일 주소 | 회원가입 | 필수 |
| 비밀번호 (단방향 해시) | 회원가입 | 필수 |
| IP 주소, User-Agent | 회원가입·로그인·동의 시점 | 자동 수집 |
| 대화 내용, 업로드 파일 | 서비스 이용 시 | 사용자 입력 |
| 외부 LLM API 키 (사용자 등록) | 사용자 설정 시 | 선택 |

## 2. 개인정보 처리 목적

- **계정 식별 및 인증**: 사용자명, 이메일, 비밀번호 해시
- **서비스 제공**: 대화 세션 관리, 모델 라우팅, 사용자별 설정
- **보안 및 감사**: IP/User-Agent, audit_logs (관리자 작업 추적), consent_logs (GDPR Article 7 동의 이력)
- **부정 사용 방지**: 비정상 트래픽 차단, rate limiting

## 3. 보유 기간

- **계정 활성 중**: 무기한 (사용자 요청 시 삭제 가능)
- **계정 삭제 시**: 아래 "사용자 탈퇴 시 데이터 처리" 정책 적용
- **audit_logs / message_feedback**: 사용자 식별자 익명화 후 감사 추적 보존 (보존 기간 별도 명시)
- **consent_logs**: 사용자 탈퇴 시 함께 삭제 (CASCADE)

## 4. 사용자 탈퇴 시 데이터 처리

서비스의 데이터 모델은 사용자 탈퇴 시 데이터를 세 카테고리로 분류 처리합니다.

### (A) 즉시 삭제되는 데이터 (CASCADE)
- 커스텀 에이전트 (custom_agents)
- 개인 스킬 (agent_skills)
- 대화 세션 (conversation_sessions)
- 사용자 메모리 (user_memories)
- 외부 API 키, OAuth 연결 (external_connections, user_api_keys)
- MCP 서버 인스턴스/등록
- 푸시 구독 (push_subscriptions)
- 동의 이력 (consent_logs)

### (B) 작성자 익명화 후 보존 (SET NULL)
- **감사 로그 (audit_logs)** — 관리자 작업 추적 의무
- **메시지 피드백 (message_feedback)** — 모델 평가 데이터
- **Skill manifest (skill_manifests)** — manifest 자체는 보존하되, `created_by` 가 NULL 로 설정되고 `is_public` 이 자동 false 처리되어 **다른 사용자에게 노출되지 않습니다** (GDPR Phase A Fix 1 보호 정책)

### (C) 참조 보호 (NO ACTION)
다음 데이터는 다른 사용자의 활동과 연관되어 있어 별도 정리 후 삭제 가능합니다.
- agent_feedback, agent_installations, agent_marketplace.author_id
- agent_reviews, agent_usage_logs, canvas_documents

해당 카테고리에 데이터가 남아 있을 경우 계정 삭제가 일시 차단될 수 있으며, 관리자가 사전 정리 안내를 드립니다.

## 5. 데이터 주체의 권리 (GDPR Article 15-22)

사용자는 다음 권리를 행사할 수 있습니다.

- **열람권 (Article 15)**: 보유 중인 개인정보 조회 — 설정 페이지 "데이터 내보내기" (현재 대화 세션 export 만 제공, 향후 manifest/agents/memories 포함 예정)
- **정정권 (Article 16)**: 설정 페이지에서 이메일/사용자명 수정
- **삭제권 (Article 17, right to erasure)**: 계정 삭제 — 본 정책 §4 의 분류대로 처리
- **처리 제한권 (Article 18)**: 별도 문의
- **이동권 (Article 20)**: 데이터 내보내기 JSON 형식
- **반대권 (Article 21)**: 별도 문의
- **자동화 의사결정 거부 (Article 22)**: 현재 자동화 의사결정 미사용

## 6. 동의 (GDPR Article 7)

회원가입 시 본 정책 및 이용약관에 대한 명시적 동의를 수집하며, 동의 이력은 다음 정보와 함께 보관됩니다.

- 동의 시점 (timestamp)
- 동의한 정책 버전 (예: 1.0)
- 동의 시 사용자 locale
- IP 주소, User-Agent

동의 철회는 별도 문의 (향후 설정 페이지에서 직접 철회 기능 추가 예정).

## 7. 제3자 제공

원칙적으로 제3자에게 개인정보를 제공하지 않습니다. 단 다음 예외:

- **LLM 서비스 호출**: 사용자 입력은 LiteLLM proxy 를 통해 vLLM backend (자체 호스팅) 로 전달됩니다. 외부 LLM 제공자 (Anthropic, OpenAI, Gemini 등) 호출은 사용자가 직접 API 키를 등록한 경우에 한해 발생하며, 해당 제공자의 정책을 따릅니다.
- **법적 요구**: 수사기관/법원의 적법한 영장 또는 명령

## 8. 보안

- 비밀번호: bcrypt 단방향 해시 저장
- 세션: HttpOnly JWT 쿠키
- 외부 API 키: AES-256-GCM 암호화 저장 (`token-crypto.ts`)
- HTTPS 권장 (운영자 인프라 의존)

## 9. 문의

본 정책 관련 문의는 서비스 관리자에게 연락 바랍니다.

---

**최종 수정일**: 2026-05-24 (버전 1.0)
