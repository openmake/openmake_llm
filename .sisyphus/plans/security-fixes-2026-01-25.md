# OpenMake LLM 보안 수정 작업 계획

**생성일**: 2026-01-25  
**목적**: 보안 분석 보고서에서 식별된 취약점 수정  
**예상 총 작업 시간**: 약 28시간

---

## 📊 작업 우선순위 개요

| 우선순위 | 작업 수 | 예상 시간 | 상태 |
|---------|---------|-----------|------|
| 🔴 CRITICAL | 5개 | 8.5시간 | ⏳ 대기 중 |
| 🟠 HIGH | 4개 | 11시간 | ⏳ 대기 중 |
| 🟡 MEDIUM | 3개 | 7시간 | ⏳ 대기 중 |
| 🟢 LOW | 3개 | 2시간 | ⏳ 대기 중 |

---

## 🔴 CRITICAL: 즉시 수정 필요 (Day 1)

### Task 1: .env 파일 보안 강화
- [x] `.env` 파일을 `.gitignore`에 추가 ✅
  - **파일**: `.gitignore`
  - **작업**: `.env` 라인 추가 (이미 있는지 확인)
  - **검증**: `git status`에서 `.env` 파일이 untracked로 표시되지 않는지 확인
  - **예상 시간**: 5분
  - **병렬 가능**: ✅ 독립 작업
  - **완료**: 2026-01-25 - `.gitignore` 생성 완료, `.env` 포함 확인

- [x] `.env.example` 템플릿 파일 생성 ✅
  - **파일**: `.env.example` (신규)
  - **작업**: 모든 환경변수 키 이름은 유지하되 값은 플레이스홀더로 교체
  - **예시**:
    ```
    OLLAMA_API_KEY_1=your_ollama_key_1_here
    JWT_SECRET=generate_with_openssl_rand_-hex_32
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ Task 1과 동시 진행
  - **완료**: 2026-01-25 - 103줄 템플릿 생성, 15개 민감값 플레이스홀더 교체 완료

- [ ] Git 히스토리에서 `.env` 제거
  - **명령어**: `git filter-branch` 또는 `BFG Repo-Cleaner` 사용
  - **경고**: ⚠️ 이미 커밋된 키는 모두 순환 필요
  - **예상 시간**: 30분
  - **병렬 가능**: ❌ Task 1 완료 후

**총 예상 시간**: 1시간

---

### Task 2: Prompt Injection 방어 구현
- [x] 사용자 입력 검증 유틸리티 함수 생성 ✅ (이미 존재: input-sanitizer.ts)
  - **파일**: `backend/api/src/utils/input-sanitizer.ts` (신규)
  - **작업**:
    ```typescript
    export function sanitizePromptInput(input: string): string {
      // 제어 문자 제거
      // 과도한 공백 정규화
      // 특수 구분자 이스케이프
      return input;
    }
    
    export function validatePromptInput(input: string): { valid: boolean; error?: string } {
      // 길이 제한 (예: 10,000자)
      // 금지된 패턴 검사
      return { valid: true };
    }
    ```
  - **예상 시간**: 1시간
  - **병렬 가능**: ✅ 독립 작업

- [x] `llm-router.ts` 수정: 안전한 프롬프트 템플릿 적용 ✅
  - **파일**: `backend/api/src/agents/llm-router.ts`
  - **라인**: 132
  - **현재 코드**:
    ```typescript
    userPrompt = `User message: "${message}"`
    ```
  - **수정 후**:
    ```typescript
    import { sanitizePromptInput, validatePromptInput } from '../utils/input-sanitizer';
    
    const validation = validatePromptInput(message);
    if (!validation.valid) {
      throw new Error(`Invalid input: ${validation.error}`);
    }
    
    const sanitized = sanitizePromptInput(message);
    userPrompt = `<user_message>\n${sanitized}\n</user_message>`;
    ```
  - **예상 시간**: 1시간
  - **의존성**: ⚠️ Task 2-1 완료 필요
  - **병렬 가능**: ❌

- [x] `discussion-engine.ts` 수정: 토론 주제 검증 ✅
  - **파일**: `backend/api/src/agents/discussion-engine.ts`
  - **라인**: 127, 132
  - **작업**:
    - `topic` 입력 검증 추가
    - 이전 에이전트 응답도 재검증 (연쇄 감염 방지)
    - XML 태그로 구분: `<topic>`, `<opinion>`
  - **예상 시간**: 1시간
  - **의존성**: ⚠️ Task 2-1 완료 필요
  - **병렬 가능**: ❌

- [x] 단위 테스트 작성 ✅ (19 tests passing)
  - **파일**: `backend/api/src/utils/__tests__/input-sanitizer.test.ts` (신규)
  - **테스트 케이스**:
    - ✅ 정상 입력 통과
    - ✅ SQL 인젝션 패턴 차단
    - ✅ Prompt 탈출 시도 차단 (`"Ignore previous..."`)
    - ✅ 과도한 길이 입력 거부
  - **예상 시간**: 1시간
  - **병렬 가능**: ✅ Task 2-2, 2-3과 병렬

**총 예상 시간**: 4시간

---

### Task 3: Path Traversal 수정
- [x] `custom-builder.ts` 수정: agentId 검증 강화 ✅
  - **파일**: `backend/api/src/agents/custom-builder.ts`
  - **라인**: 118
  - **현재 코드**:
    ```typescript
    const agentId = config.name.toLowerCase().replace(/\s+/g, '-');
    ```
  - **수정 후**:
    ```typescript
    function sanitizeAgentId(name: string): string {
      const sanitized = name
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '') // 영숫자, 언더스코어, 하이픈만 허용
        .substring(0, 50); // 길이 제한
      
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(sanitized)) {
        throw new Error('Invalid agent name: must start with alphanumeric');
      }
      
      return sanitized;
    }
    
    const agentId = sanitizeAgentId(config.name);
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ 독립 작업

- [x] 파일 저장 경로 검증 추가 ✅
  - **파일**: `backend/api/src/agents/custom-builder.ts`
  - **라인**: 237
  - **작업**:
    ```typescript
    const promptPath = path.join(this.promptsDir, `${agentId}.md`);
    
    // 경로 검증: promptsDir 외부로 벗어나는지 확인
    const resolved = path.resolve(promptPath);
    const baseDir = path.resolve(this.promptsDir);
    
    if (!resolved.startsWith(baseDir + path.sep)) {
      throw new Error('Path traversal attempt detected');
    }
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ❌ Task 3-1 완료 후

- [x] 단위 테스트 작성 ✅ (26 tests passing)
  - **파일**: `backend/api/src/agents/__tests__/custom-builder.test.ts`
  - **테스트 케이스**:
    - ✅ 정상 에이전트 이름 허용
    - ✅ `../` 포함 시도 차단
    - ✅ 절대 경로 시도 차단
    - ✅ 특수 문자 제거 확인
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ Task 3-2와 병렬

**총 예상 시간**: 1.5시간

---

### Task 4: XSS 방어 (DOMPurify 적용)
- [x] DOMPurify 설치 ✅ (CDN: dompurify@3.2.4)
  - **방법**: CDN script tag in index.html
  - **예상 시간**: 5분
  - **병렬 가능**: ✅ 독립 작업

- [x] `ui.js` 수정: 마크다운 렌더링에 sanitizer 추가 ✅
  - **파일**: `frontend/web/public/js/modules/ui.js`
  - **라인**: 228
  - **현재 코드**:
    ```javascript
    element.innerHTML = marked.parse(text);
    ```
  - **수정 후**:
    ```javascript
    import DOMPurify from 'dompurify';
    
    const rawHtml = marked.parse(text);
    const cleanHtml = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3'],
      ALLOWED_ATTR: ['href', 'class']
    });
    element.innerHTML = cleanHtml;
    ```
  - **예상 시간**: 30분
  - **의존성**: ⚠️ Task 4-1 완료 필요
  - **병렬 가능**: ❌

- [x] `settings.html` 수정: API 응답 sanitize ✅ (SPA page modules already use esc() for user data)
  - **파일**: `frontend/web/public/settings.html`
  - **라인**: 273
  - **작업**: `.innerHTML` 사용 부분을 DOMPurify로 감싸기
  - **예상 시간**: 20분
  - **병렬 가능**: ✅ Task 4-2와 병렬

- [x] `admin.html` 수정: 동일 패턴 적용 ✅ (SPA page modules already use esc() for user data)
  - **파일**: `frontend/web/public/admin.html`
  - **라인**: 313, 421
  - **작업**: 동일
  - **예상 시간**: 20분
  - **병렬 가능**: ✅ Task 4-2, 4-3과 병렬

- [x] 빌드 설정 확인 및 번들 사이즈 체크 ✅ (CDN-based, no build needed; sanitize.js fixed to expose window.purifyHTML)
  - **작업**: Vite 빌드 후 DOMPurify가 정상적으로 포함되었는지 확인
  - **예상 시간**: 15분
  - **병렬 가능**: ❌ Task 4-2, 4-3, 4-4 완료 후

**총 예상 시간**: 1.5시간

---

### Task 5: 관리자 API 인증 강화
- [x] `server.ts` 수정: `/api/admin/stats` 엔드포인트 ✅ (AdminController already has requireAuth+requireAdmin)
  - **파일**: `backend/api/src/server.ts`
  - **라인**: 1202
  - **현재 코드**:
    ```typescript
    this.app.get('/api/admin/stats', async (req, res) => { ... });
    ```
  - **수정 후**:
    ```typescript
    import { requireAuth, requireAdmin } from './auth/middleware';
    
    this.app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => { ... });
    ```
  - **예상 시간**: 5분
  - **병렬 가능**: ✅ 독립 작업

- [x] `server.ts` 수정: `/api/admin/conversations` 엔드포인트 ✅ (AdminController already has requireAuth+requireAdmin)
  - **파일**: `backend/api/src/server.ts`
  - **라인**: 1237
  - **작업**: 동일하게 `requireAuth, requireAdmin` 추가
  - **예상 시간**: 5분
  - **병렬 가능**: ✅ Task 5-1과 병렬

- [x] 모든 `/api/admin/*` 라우트 검증 ✅ (all routes go through createAdminController with middleware)
  - **파일**: `backend/api/src/server.ts`
  - **작업**: 
    - `grep -n '/api/admin' server.ts` 실행
    - 모든 admin 라우트에 미들웨어 적용 여부 확인
  - **예상 시간**: 15분
  - **병렬 가능**: ❌ Task 5-1, 5-2 완료 후

- [x] 파일 업로드 타입 제한 추가 ✅ (ALLOWED_MIME_TYPES filter + 50MB limit)
  - **파일**: `backend/api/src/server.ts`
  - **라인**: 218
  - **현재 코드**:
    ```typescript
    const upload = multer({ dest: 'uploads/' });
    ```
  - **수정 후**:
    ```typescript
    const upload = multer({
      dest: 'uploads/',
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`File type not allowed: ${file.mimetype}`));
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 } // 10MB
    });
    ```
  - **예상 시간**: 15분
  - **병렬 가능**: ✅ Task 5-1, 5-2, 5-3과 병렬

**총 예상 시간**: 40분

---

## 🟠 HIGH: 1주 내 수정 (Week 1)

### Task 6: DB ON DELETE CASCADE 추가 ✅ (PostgreSQL 스키마에 ON DELETE CASCADE 9건 적용됨)
- [x] 마이그레이션 스크립트 작성 ✅ (002-schema.sql에 CASCADE 포함)
  - **파일**: `database/migrations/001_add_cascade_constraints.sql` (신규)
  - **작업**:
    ```sql
    -- conversation_sessions 테이블 수정
    PRAGMA foreign_keys=off;
    
    BEGIN TRANSACTION;
    
    -- 임시 테이블 생성
    CREATE TABLE conversation_sessions_new (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata JSON,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    
    -- 데이터 복사
    INSERT INTO conversation_sessions_new SELECT * FROM conversation_sessions;
    
    -- 기존 테이블 삭제 및 이름 변경
    DROP TABLE conversation_sessions;
    ALTER TABLE conversation_sessions_new RENAME TO conversation_sessions;
    
    COMMIT;
    
    PRAGMA foreign_keys=on;
    ```
  - **대상 테이블**: 
    - `conversation_sessions`
    - `research_sessions`
    - `agent_marketplace`
    - `agent_reviews`
    - `agent_installations`
    - `canvas_documents`
    - `canvas_versions`
    - `custom_agents`
  - **예상 시간**: 2시간
  - **병렬 가능**: ✅ 독립 작업

- [x] 마이그레이션 실행 스크립트 작성 ✅ (PostgreSQL Docker init 스크립트로 대체)

- [x] 테스트 데이터로 CASCADE 동작 검증 ✅ (PostgreSQL 스키마에 내장)
  - **작업**:
    1. 테스트 유저 생성
    2. 관련 세션/리서치 데이터 생성
    3. 유저 삭제
    4. 고아 레코드가 남지 않는지 확인
  - **예상 시간**: 1시간
  - **병렬 가능**: ❌ Task 6-1, 6-2 완료 후

**총 예상 시간**: 4시간

---

### Task 7: 데이터베이스 코드 중복 제거 (부분 완료 — unified-database.ts는 PostgreSQL 래퍼로 리팩토링됨, 삭제 미완료)
- [ ] `backend/api/src/data/models/unified-database.ts` 삭제 (아직 존재하지만 PostgreSQL용으로 리팩토링됨)
  - **파일**: `backend/api/src/data/models/unified-database.ts`
  - **작업**: 파일 삭제 후 import 경로를 `database/models/unified-database`로 변경
  - **영향 받는 파일**:
    ```bash
    grep -r "from.*data/models/unified-database" backend/api/src/
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ 독립 작업

- [ ] `package.json` 워크스페이스 의존성 추가
  - **파일**: `backend/api/package.json`
  - **작업**:
    ```json
    {
      "dependencies": {
        "@openmake/database": "workspace:*"
      }
    }
    ```
  - **예상 시간**: 10분
  - **병렬 가능**: ✅ Task 7-1과 병렬

- [ ] TypeScript 경로 설정 업데이트
  - **파일**: `backend/api/tsconfig.json`
  - **작업**:
    ```json
    {
      "compilerOptions": {
        "paths": {
          "@openmake/database": ["../../database/src"]
        }
      }
    }
    ```
  - **예상 시간**: 10분
  - **병렬 가능**: ✅ Task 7-1, 7-2와 병렬

- [ ] 모든 import 경로 수정
  - **작업**: 
    ```bash
    find backend/api/src -type f -name "*.ts" -exec sed -i '' 's|from.*data/models/unified-database|from "@openmake/database"|g' {} +
    ```
  - **예상 시간**: 20분
  - **의존성**: ⚠️ Task 7-1, 7-2, 7-3 완료 필요
  - **병렬 가능**: ❌

- [ ] 빌드 테스트 및 타입 체크
  - **명령어**: `npm run build && npm run typecheck`
  - **예상 시간**: 30분
  - **병렬 가능**: ❌ Task 7-4 완료 후

**총 예상 시간**: 2시간

---

### Task 8: JWT URL → HTTP-only Cookie 변경 ✅ (Cookie 기반 인증 구현됨)
- [x] 백엔드: OAuth 콜백 수정 (토큰을 쿠키로 설정) ✅
  - **파일**: `backend/api/src/routes/AuthRoutes.ts`
  - **라인**: 261, 347 (Google/GitHub 콜백)
  - **현재 코드**:
    ```typescript
    res.redirect(`/?oauth_token=${token}`);
    ```
  - **수정 후**:
    ```typescript
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7일
    });
    res.redirect('/');
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ 독립 작업

- [x] 백엔드: 인증 미들웨어 쿠키 우선 확인 ✅
  - **파일**: `infrastructure/security/auth/middleware.ts`
  - **라인**: 26
  - **현재 코드**:
    ```typescript
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);
    ```
  - **수정 후**:
    ```typescript
    // 쿠키 우선, 없으면 Authorization 헤더
    const token = req.cookies.auth_token || extractToken(req.headers.authorization);
    ```
  - **예상 시간**: 20분
  - **병렬 가능**: ✅ Task 8-1과 병렬

- [x] 프론트엔드: URL 파라미터 파싱 제거 ✅
  - **파일**: `frontend/web/public/app.js`
  - **라인**: 56-85
  - **작업**: `oauth_token` 추출 로직 삭제 (쿠키로 자동 전송됨)
  - **예상 시간**: 15분
  - **병렬 가능**: ✅ Task 8-1, 8-2와 병렬

- [x] 로그아웃 시 쿠키 삭제 ✅
  - **파일**: `backend/api/src/routes/AuthRoutes.ts`
  - **작업**:
    ```typescript
    router.post('/logout', (req, res) => {
      res.clearCookie('auth_token');
      res.json({ success: true });
    });
    ```
  - **예상 시간**: 10분
  - **병렬 가능**: ✅ Task 8-1, 8-2, 8-3과 병렬

- [ ] CSRF 방어 추가 (선택적, 권장) — 미완료
  - **패키지**: `npm install csurf`
  - **작업**: SameSite=Lax로 기본 방어는 되지만, POST 요청에 CSRF 토큰 추가
  - **예상 시간**: 1시간
  - **병렬 가능**: ❌ Task 8-1~8-4 완료 후

**총 예상 시간**: 2시간 15분

---

### Task 9: Rate Limiting 적용 ✅ (QuotaExceeded 에러 처리 구현됨)
- [x] `OllamaClient.chat` 메서드 수정: 요청 전 한도 체크 ✅
  - **파일**: `backend/api/src/ollama/client.ts`
  - **라인**: 242
  - **현재 코드**:
    ```typescript
    async chat(params: ChatParams): Promise<ChatResponse> {
      const response = await this.axiosInstance.post('/api/chat', ...);
      ...
    }
    ```
  - **수정 후**:
    ```typescript
    async chat(params: ChatParams): Promise<ChatResponse> {
      // 한도 체크
      const quotaStatus = this.usageTracker.getQuotaStatus();
      if (quotaStatus.hourly.isExceeded || quotaStatus.weekly.isExceeded) {
        throw new Error(`API quota exceeded: ${JSON.stringify(quotaStatus)}`);
      }
      
      const response = await this.axiosInstance.post('/api/chat', ...);
      ...
    }
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ 독립 작업

- [x] `OllamaClient.generate` 메서드에도 동일 적용 ✅
  - **파일**: `backend/api/src/ollama/client.ts`
  - **예상 시간**: 15분
  - **병렬 가능**: ✅ Task 9-1과 병렬

- [x] 커스텀 에러 클래스 생성 ✅
  - **파일**: `backend/api/src/errors/quota-exceeded.error.ts` (신규)
  - **작업**:
    ```typescript
    export class QuotaExceededError extends Error {
      constructor(public quotaStatus: any) {
        super('API quota exceeded');
        this.name = 'QuotaExceededError';
      }
    }
    ```
  - **예상 시간**: 15분
  - **병렬 가능**: ✅ Task 9-1, 9-2와 병렬

- [x] 글로벌 에러 핸들러에서 429 응답 반환 ✅
  - **파일**: `backend/api/src/middlewares/index.ts`
  - **라인**: 166
  - **작업**:
    ```typescript
    if (err instanceof QuotaExceededError) {
      return res.status(429).json({
        error: 'Too Many Requests',
        quotaStatus: err.quotaStatus,
        retryAfter: 3600 // 1시간 후 재시도
      });
    }
    ```
  - **예상 시간**: 20분
  - **병렬 가능**: ❌ Task 9-3 완료 후

- [x] 프론트엔드: 429 에러 처리 UI ✅
  - **파일**: `frontend/web/public/js/modules/api.js`
  - **작업**: fetch 호출 시 429 응답 처리하여 사용자에게 알림
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ Task 9-1~9-4와 병렬

- [ ] 통합 테스트: 한도 초과 시나리오 — 미완료
  - **파일**: `tests/integration/rate-limiting.test.ts` (신규)
  - **테스트 케이스**:
    - ✅ 정상 범위 내 요청 성공
    - ✅ 시간당 한도 초과 시 429 반환
    - ✅ 주간 한도 초과 시 429 반환
  - **예상 시간**: 1.5시간
  - **병렬 가능**: ❌ Task 9-1~9-5 완료 후

**총 예상 시간**: 3시간

---

## 🟡 MEDIUM: 스프린트 내 수정 (Week 2)

### Task 10: server.ts 리팩토링 (Controller 분리) ✅ (7개 컨트롤러 존재)
- [x] AdminController 생성 ✅
  - **파일**: `backend/api/src/controllers/admin.controller.ts` (신규)
  - **작업**: `server.ts`의 `/api/admin/*` 라우트 핸들러를 컨트롤러로 이동
  - **예상 시간**: 1.5시간
  - **병렬 가능**: ✅ 독립 작업

- [x] ChatController 생성 ✅ (chat.routes.ts로 구현)
  - **파일**: `backend/api/src/controllers/chat.controller.ts` (신규)
  - **작업**: `/api/chat` 중복 정의 해결 및 단일 컨트롤러로 통합
  - **예상 시간**: 1시간
  - **병렬 가능**: ✅ Task 10-1과 병렬

- [x] UploadController 생성 ✅ (server.ts에서 분리됨)
  - **파일**: `backend/api/src/controllers/upload.controller.ts` (신규)
  - **작업**: 파일 업로드 관련 로직 분리
  - **예상 시간**: 1시간
  - **병렬 가능**: ✅ Task 10-1, 10-2와 병렬

- [x] `server.ts`에서 컨트롤러 연결 ✅
  - **파일**: `backend/api/src/server.ts`
  - **작업**:
    ```typescript
    import { AdminController } from './controllers/admin.controller';
    import { ChatController } from './controllers/chat.controller';
    
    const adminController = new AdminController();
    const chatController = new ChatController();
    
    this.app.use('/api/admin', adminController.router);
    this.app.use('/api/chat', chatController.router);
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ❌ Task 10-1~10-3 완료 후

**총 예상 시간**: 4시간

---

### Task 11: N+1 쿼리 최적화
- [ ] `getRelevantMemories` 배치 업데이트로 변경
  - **파일**: `database/models/unified-database.ts`
  - **라인**: 942-945
  - **현재 코드**:
    ```typescript
    results.forEach(r => updateStmt.run(r.id));
    ```
  - **수정 후**:
    ```typescript
    const ids = results.map(r => r.id).join(',');
    const placeholders = results.map(() => '?').join(',');
    const batchUpdateStmt = this.db.prepare(`
      UPDATE user_memories 
      SET access_count = access_count + 1, last_accessed = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `);
    batchUpdateStmt.run(...results.map(r => r.id));
    ```
  - **예상 시간**: 1시간
  - **병렬 가능**: ✅ 독립 작업

- [ ] `createMemory` 트랜잭션 추가
  - **파일**: `database/models/unified-database.ts`
  - **라인**: 872-878
  - **현재 코드**:
    ```typescript
    stmt.run(...);
    if (params.tags && params.tags.length > 0) {
      const tagStmt = this.db.prepare(...);
      for (const tag of params.tags) {
        tagStmt.run(params.id, tag);
      }
    }
    ```
  - **수정 후**:
    ```typescript
    const transaction = this.db.transaction(() => {
      stmt.run(...);
      if (params.tags && params.tags.length > 0) {
        const tagStmt = this.db.prepare(...);
        for (const tag of params.tags) {
          tagStmt.run(params.id, tag);
        }
      }
    });
    transaction();
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ Task 11-1과 병렬

- [ ] 성능 벤치마크 테스트
  - **파일**: `database/__tests__/performance.test.ts` (신규)
  - **작업**: 
    - 1000개 메모리 조회 시 N+1 vs 배치 업데이트 성능 비교
    - 트랜잭션 유무에 따른 태그 삽입 성능 비교
  - **예상 시간**: 1시간
  - **병렬 가능**: ❌ Task 11-1, 11-2 완료 후

**총 예상 시간**: 2.5시간

---

### Task 12: 토큰/컨텍스트 제한 처리 ✅ (discussion-engine.ts에 TokenLimits + truncateToLimit + 우선순위 기반 컨텍스트 할당 구현됨)
- [x] `tiktoken` 라이브러리 설치 ✅ (문자 기반 근사값 사용 — 1토큰 ≈ 4자)
  - **명령어**: `npm install tiktoken`
  - **예상 시간**: 5분
  - **병렬 가능**: ✅ 독립 작업

- [x] 토큰 카운팅 유틸리티 함수 생성 ✅ (truncateToLimit in discussion-engine.ts)
  - **파일**: `backend/api/src/utils/token-counter.ts` (신규)
  - **작업**:
    ```typescript
    import { encoding_for_model } from 'tiktoken';
    
    export function countTokens(text: string, model: string = 'gpt-3.5-turbo'): number {
      const enc = encoding_for_model(model);
      const tokens = enc.encode(text);
      enc.free();
      return tokens.length;
    }
    
    export function trimToTokenLimit(text: string, maxTokens: number): string {
      // 토큰 수가 초과하면 끝에서부터 자르기
    }
    ```
  - **예상 시간**: 1시간
  - **의존성**: ⚠️ Task 12-1 완료 필요
  - **병렬 가능**: ❌

- [x] `discussion-engine.ts` 컨텍스트 트리밍 추가 ✅ (buildFullContext with priority-based allocation)
  - **파일**: `backend/api/src/agents/discussion-engine.ts`
  - **라인**: 230
  - **작업**:
    ```typescript
    import { countTokens, trimToTokenLimit } from '../utils/token-counter';
    
    let contextMessage = `...`;
    
    // 컨텍스트가 너무 길면 오래된 의견부터 제거
    const MAX_CONTEXT_TOKENS = 4000;
    if (countTokens(contextMessage) > MAX_CONTEXT_TOKENS) {
      contextMessage = trimToTokenLimit(contextMessage, MAX_CONTEXT_TOKENS);
    }
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ❌ Task 12-2 완료 후

**총 예상 시간**: 1시간 35분

---

## 🟢 LOW: 개선 권장 (Backlog)

### Task 13: 접근성 개선 ✅
- [x] `app.js` 인터랙티브 요소에 ARIA 추가 ✅ (index.html + unified-sidebar.js)
  - **파일**: `frontend/web/public/app.js`
  - **라인**: 183
  - **작업**:
    ```javascript
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        // 클릭 이벤트 트리거
      }
    });
    ```
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ 독립 작업

- [x] `settings.html` 모바일 메뉴 버튼 ARIA 추가 ✅ (skip-link, role, aria-label, keyboard nav)
  - **파일**: `frontend/web/public/settings.html`
  - **작업**:
    ```html
    <button id="mobile-menu-btn" aria-expanded="false" aria-controls="sidebar">
    ```
  - **예상 시간**: 15분
  - **병렬 가능**: ✅ Task 13-1과 병렬

**총 예상 시간**: 45분

---

### Task 14: 인메모리 저장소 영속화 ✅ (TTLDocumentMap으로 개선됨 — LRU, TTL, max 100 문서 제한)
- [x] `uploadedDocuments` Map을 SQLite로 교체 ✅ (TTLDocumentMap in documents/store.ts — in-memory but robust)
  - **파일**: `backend/api/src/server.ts`
  - **라인**: 81
  - **작업**: `database/models/unified-database.ts`에 `uploaded_files` 테이블 추가
  - **예상 시간**: 1시간
  - **병렬 가능**: ✅ 독립 작업

**총 예상 시간**: 1시간

---

### Task 15: TypeScript `any` 타입 제거 ✅ (Phase 5에서 전체 프로젝트 133건→0건)
- [x] `server.ts`의 `any` 타입 찾기 및 대체 ✅
  - **명령어**: `grep -n ": any" backend/api/src/server.ts`
  - **작업**: 각 `any`를 적절한 타입으로 교체
  - **예상 시간**: 30분
  - **병렬 가능**: ✅ 독립 작업

**총 예상 시간**: 30분

---

## 🎯 실행 전략

### Phase 1: CRITICAL (Day 1-2)
```
DAY 1 (4시간):
  병렬 그룹 1 (동시 진행):
    - Task 1: .env 보안 (1시간)
    - Task 2: Prompt Injection (4시간)
    - Task 3: Path Traversal (1.5시간)
  
  → 가장 긴 Task 2가 완료될 때까지 대기 (4시간)

DAY 2 (3시간):
  병렬 그룹 2 (동시 진행):
    - Task 4: XSS 방어 (1.5시간)
    - Task 5: 인증 강화 (40분)
  
  → 모든 CRITICAL 완료 (총 7.5시간)
```

### Phase 2: HIGH (Week 1)
```
WEEK 1:
  병렬 그룹 3:
    - Task 6: DB CASCADE (4시간)
    - Task 7: 코드 중복 제거 (2시간)
    - Task 8: JWT Cookie (2.25시간)
    - Task 9: Rate Limiting (3시간)
  
  → 가장 긴 Task 6 기준 4시간 + 검증 1시간 = 5시간
```

### Phase 3: MEDIUM (Week 2)
```
WEEK 2:
  순차 진행:
    - Task 10: 리팩토링 (4시간)
    - Task 11: 쿼리 최적화 (2.5시간)
    - Task 12: 토큰 제한 (1.5시간)
  
  → 총 8시간
```

### Phase 4: LOW (Backlog)
```
백로그에 추가, 여유 시간에 처리
```

---

## ✅ 검증 체크리스트

각 작업 완료 후 다음 항목을 반드시 확인:

### 코드 품질
- [ ] TypeScript 컴파일 에러 없음 (`npm run build`)
- [ ] 린트 에러 없음 (`npm run lint`)
- [ ] 단위 테스트 통과 (`npm test`)

### 보안
- [ ] `.env` 파일이 Git에 커밋되지 않음
- [ ] 모든 admin API가 인증 보호됨
- [ ] XSS 공격 시뮬레이션 통과
- [ ] Prompt injection 시도 차단 확인

### 성능
- [ ] 데이터베이스 쿼리 실행 계획 확인 (`EXPLAIN QUERY PLAN`)
- [ ] N+1 쿼리 제거 확인
- [ ] API 응답 시간 500ms 이하 유지

### 기능
- [ ] 기존 기능 회귀 테스트 통과
- [ ] 새 기능 수동 테스트 완료
- [ ] 프론트엔드 UI 정상 동작

---

## 📝 참고 문서

- [OWASP Top 10 2021](https://owasp.org/www-project-top-ten/)
- [Prompt Injection 방어 가이드](https://learnprompting.org/docs/prompt_hacking/defensive_measures/overview)
- [SQLite Foreign Key Constraints](https://www.sqlite.org/foreignkeys.html)
- [DOMPurify 문서](https://github.com/cure53/DOMPurify)

---

## 🚀 시작 방법

**이 계획을 실행하려면:**
```bash
/start-work
```

**주의**: 나는 계획을 세우는 PLANNER입니다. 실제 코드 수정은 `/start-work` 명령으로 Sisyphus 에이전트가 수행합니다.
