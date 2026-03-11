## REQUIRED: Task Lifecycle Commands
You MUST run these commands. Do NOT skip any step.

1. Claim your task:
   omc team api claim-task --input '{"team_name":"openmake-llm-users-tom-project","task_id":"3","worker":"worker-3"}' --json
   Save the claim_token from the response.
2. Do the work described below.
3. On completion (use claim_token from step 1):
   omc team api transition-task-status --input '{"team_name":"openmake-llm-users-tom-project","task_id":"3","from":"in_progress","to":"completed","claim_token":"<claim_token>"}' --json
4. On failure (use claim_token from step 1):
   omc team api transition-task-status --input '{"team_name":"openmake-llm-users-tom-project","task_id":"3","from":"in_progress","to":"failed","claim_token":"<claim_token>"}' --json
5. Exit immediately after transitioning.

## Task Assignment
Task ID: 3
Worker: worker-3
Subject: Worker 3: OpenMake LLM 프로젝트(/Users/tom/projects/development/openmake_llm) Phase 

OpenMake LLM 프로젝트(/Users/tom/projects/development/openmake_llm) Phase 2 리팩토링. 각 워커는 아래 할당된 작업만 수행하세요.

[Worker 1 - routes/setup.ts의 Setter DI → 팩토리 함수 전환]
- backend/api/src/routes/setup.ts를 읽고, setClusterManager 같은 모듈-레벨 setter 호출(약 6개)을 파악
- 각 라우트 파일(chat.routes.ts, metrics.routes.ts 등)에서 모듈-레벨 setter 패턴을 팩토리 함수 패턴으로 변환
- Before: import chatRouter, { setClusterManager } from './chat.routes'; setClusterManager(cluster); app.use('/api/chat', chatRouter);
- After: import { createChatRouter } from './chat.routes'; app.use('/api/chat', createChatRouter({ cluster }));
- 각 라우트 파일에서 모듈-레벨 변수(let clusterManager)를 제거하고, 팩토리 함수 인자로 받도록 변경
- setup.ts에서 모든 setter 호출을 팩토리 함수 호출로 교체
- 변경 후 cd backend/api && npx tsc --noEmit으로 빌드 확인

[Worker 2 - 극소 디렉토리 흡수]
- backend/api/src/workflow/graph-engine.ts를 backend/api/src/utils/graph-engine.ts로 이동
- backend/api/src/workflow/ 디렉토리 삭제
- backend/api/src/workflow/AGENTS.md도 삭제
- workflow/graph-engine.ts를 import하는 파일이 있으면 import 경로를 utils/graph-engine으로 변경
- backend/api/src/errors/ 4개 파일을 backend/api/src/utils/errors/로 이동 (디렉토리 생성)
- errors/를 import하는 파일들의 import 경로를 utils/errors/로 변경
- backend/api/src/errors/AGENTS.md를 backend/api/src/utils/errors/AGENTS.md로 이동 (Parent 태그 수정)
- backend/api/src/errors/ 디렉토리 삭제
- 변경 후 cd backend/api && npx tsc --noEmit으로 빌드 확인

[Worker 3 - 프론트엔드 페이지 모듈 패턴 통일 (21개 중 window.PageModules 사용 파일만)]
- frontend/web/public/js/modules/pages/ 안의 21개 파일을 확인
- window.PageModules.xxx = { getHTML, init, cleanup } 패턴을 사용하는 파일을 찾기
- 해당 파일들을 ES Module export default { getHTML, init, cleanup } 패턴으로 변환
- window.PageModules 등록 코드 제거
- spa-router.js에서 window.PageModules fallback을 사용하는 부분 확인 (즉시 제거하지 말고 주석 처리만 — 전체 통일 후 제거)
- 변경 후 기존 동작이 깨지지 않도록 spa-router.js가 dynamic import + window.PageModules fallback 모두 지원하는지 확인
- 모든 페이지가 ES Module export default 패턴으로 통일되면 주석 안내 추가

모든 변경 후 빌드 확인. TypeScript: cd backend/api && npx tsc --noEmit. 빌드 실패 시 수정 후 재시도.

REMINDER: You MUST run transition-task-status before exiting. Do NOT write done.json or edit task files directly.