## REQUIRED: Task Lifecycle Commands
You MUST run these commands. Do NOT skip any step.

1. Claim your task:
   omc team api claim-task --input '{"team_name":"openmake-llm-users-tom-project","task_id":"1","worker":"worker-1"}' --json
   Save the claim_token from the response.
2. Do the work described below.
3. On completion (use claim_token from step 1):
   omc team api transition-task-status --input '{"team_name":"openmake-llm-users-tom-project","task_id":"1","from":"in_progress","to":"completed","claim_token":"<claim_token>"}' --json
4. On failure (use claim_token from step 1):
   omc team api transition-task-status --input '{"team_name":"openmake-llm-users-tom-project","task_id":"1","from":"in_progress","to":"failed","claim_token":"<claim_token>"}' --json
5. Exit immediately after transitioning.

## Task Assignment
Task ID: 1
Worker: worker-1
Subject: Worker 1: OpenMake LLM 프로젝트(/Users/tom/projects/development/openmake_llm) Phase 

OpenMake LLM 프로젝트(/Users/tom/projects/development/openmake_llm) Phase 3 리팩토링 — Chat 도메인 통합.

현재 chat 관련 코드가 6곳에 분산:
1. backend/api/src/chat/ — 쿼리 분류, 모델 선택, 프롬프트, 시맨틱 캐시, request-handler
2. backend/api/src/services/ChatService.ts — 중앙 오케스트레이터
3. backend/api/src/services/chat-service/ — ChatService 내부 모듈
4. backend/api/src/services/chat-strategies/ — Strategy 패턴 (direct, a2a, discussion, deep-research, agent-loop)
5. backend/api/src/sockets/ws-chat-handler.ts — WebSocket 핸들러
6. backend/api/src/routes/chat.routes.ts — HTTP 라우트

목표: backend/api/src/domains/chat/ 디렉토리로 통합

[Worker 1 — 파일 이동 + import 경로 수정]
1. backend/api/src/domains/chat/ 디렉토리 구조 생성:
   - domains/chat/pipeline/ ← 현재 chat/ 의 모든 파일 이동
   - domains/chat/strategies/ ← 현재 services/chat-strategies/ 이동  
   - domains/chat/service/ ← 현재 services/chat-service/ 이동
   - domains/chat/service.ts ← 현재 services/ChatService.ts 이동

2. 모든 이동된 파일과 이를 참조하는 파일의 import 경로 수정
   - 특히 services/ChatService.ts를 import하는 파일이 많으므로 주의
   - chat/ 디렉토리의 파일을 import하는 파일도 모두 수정
   - services/chat-strategies/를 import하는 파일도 수정

3. 기존 chat/, services/chat-service/, services/chat-strategies/ 디렉토리 삭제
4. services/ChatService.ts 삭제 (domains/chat/service.ts로 이동했으므로)

주의사항:
- git mv 사용으로 git history 보존
- import 경로 수정 시 상대 경로 정확하게 계산
- barrel export (index.ts) 추가 고려
- TypeScript 빌드 반드시 확인: cd backend/api && npx tsc --noEmit

[Worker 2 — WebSocket + 라우트 + 테스트 + AGENTS.md]
1. sockets/ws-chat-handler.ts의 chat 관련 import 경로를 domains/chat/으로 변경
   (ws-chat-handler.ts 자체는 sockets/에 유지 — WebSocket은 transport layer)
2. routes/chat.routes.ts의 import 경로를 domains/chat/으로 변경
   (chat.routes.ts도 routes/에 유지 — routing은 api layer)
3. __tests__/ 안의 테스트 파일들의 import 경로 수정
4. domains/chat/AGENTS.md 생성 (Parent: ../AGENTS.md)
5. domains/chat/pipeline/AGENTS.md 생성
6. domains/chat/strategies/AGENTS.md 생성
7. 이동 후 빈 디렉토리 정리

빌드 확인: cd backend/api && npx tsc --noEmit
빌드 실패 시 import 경로 오류를 수정하고 재시도.

REMINDER: You MUST run transition-task-status before exiting. Do NOT write done.json or edit task files directly.