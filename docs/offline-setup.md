# OpenMake LLM 오프라인 환경 구성 가이드

인터넷 없는 폐쇄망/오프라인 환경에서 OpenMake LLM의 RAG 포함 전 기능을 사용하기 위한 가이드입니다.

## 외부 의존성 분석

| 구분 | 서비스 | 오프라인 영향 | 필수 여부 |
|------|--------|-------------|----------|
| **필수** | Ollama (LLM + 임베딩) | 로컬 설치 필요 | YES |
| **필수** | PostgreSQL + pgvector | 로컬 설치 필요 | YES |
| **불필요** | Google/GitHub OAuth | 로컬 인증으로 대체 | NO |
| **불필요** | Google Search API | 오프라인에서 비활성 | NO |
| **불필요** | Firecrawl API | API 키 없으면 미로드 | NO |
| **불필요** | DuckDuckGo/Wikipedia/Naver | 오프라인에서 비활성 | NO |
| **불필요** | OpenTelemetry OTLP | 모니터링만 영향 | NO |
| **안전** | 프론트엔드 자산 | 전부 self-hosted | - |

## Step 1: 인프라 준비

### PostgreSQL + pgvector

```bash
# macOS
brew install postgresql@16
brew install pgvector

# 또는 Docker
docker run -d --name openmake-db \
  -e POSTGRES_DB=openmake_llm \
  -e POSTGRES_USER=openmake \
  -e POSTGRES_PASSWORD=<password> \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# pgvector 확장 활성화
psql -d openmake_llm -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Ollama 설치 및 모델 다운로드

인터넷이 있는 환경에서 미리 다운로드합니다:

```bash
# Ollama 설치
curl -fsSL https://ollama.com/install.sh | sh

# 필요한 모델 다운로드
ollama pull mistral          # 메인 채팅 모델 (또는 선호하는 모델)
ollama pull nomic-embed-text # RAG 임베딩 모델 (필수)

# 오프라인 환경으로 이동 후
ollama serve
```

### PDF OCR 의존성 (선택)

```bash
brew install poppler  # PDF → 이미지 변환용
```

## Step 2: .env 오프라인 설정

`.env.example`을 복사하여 `.env`를 만들고 아래와 같이 설정합니다:

```env
# === 서버 ===
PORT=52416
NODE_ENV=production

# === 데이터베이스 (로컬) ===
DATABASE_URL=postgresql://openmake:<password>@localhost:5432/openmake_llm

# === Ollama (로컬) ===
OLLAMA_HOST=http://localhost:11434
OLLAMA_API_KEY_1=local-key-1

# === 인증 (로컬 전용) ===
JWT_SECRET=<32자 이상 랜덤 문자열>
API_KEY_PEPPER=<임의 문자열>
ADMIN_PASSWORD=<관리자 비밀번호>
DEFAULT_ADMIN_EMAIL=admin@localhost
# Google/GitHub OAuth 환경변수는 설정하지 않음 (자동 비활성화)

# === 모델 프로필 ===
OMK_ENGINE_DEFAULT=mistral:latest
OMK_ENGINE_PRO=mistral:latest
OMK_ENGINE_FAST=mistral:latest
OMK_ENGINE_THINK=mistral:latest
OMK_ENGINE_CODE=mistral:latest

# === 외부 서비스 비활성화 ===
# FIRECRAWL_API_KEY → 설정하지 않음
# GOOGLE_API_KEY → 설정하지 않음
# GEMINI_API_KEY → 설정하지 않음
OTEL_ENABLED=false
```

> **참고**: `JWT_SECRET`은 프로덕션에서 32자 이상 필수이며, `API_KEY_PEPPER`도 프로덕션에서 필수입니다 (env.ts 검증 로직).

## Step 3: 빌드 및 시작

```bash
npm run build
npm start

# 또는 개발 모드
npm run dev
```

## Step 4: 로그인

1. 서버 시작 시 `ADMIN_PASSWORD`로 관리자 계정 자동 생성됨 (`admin@localhost`)
2. 브라우저에서 `http://localhost:52416` 접속
3. `admin@localhost` + 설정한 `ADMIN_PASSWORD`로 로그인
4. 추가 사용자: `/api/auth/register`로 로컬 계정 생성 (이메일 + 비밀번호)

OAuth 버튼은 `AuthService.getAvailableProviders()`가 빈 배열을 반환하므로 UI에 표시되지 않습니다.

## Step 5: RAG 기능 사용

RAG 파이프라인은 100% 오프라인 가능합니다:

| 단계 | 구현 | 오프라인 |
|------|------|---------|
| 문서 업로드 | 로컬 파일 처리 | ✅ |
| 텍스트 추출 | pdf-parse + Tesseract.js | ✅ |
| 청킹 | 로컬 알고리즘 | ✅ |
| 임베딩 생성 | Ollama `nomic-embed-text` | ✅ |
| 벡터 저장/검색 | PostgreSQL + pgvector | ✅ |
| 하이브리드 검색 (RRF) | 로컬 연산 | ✅ |
| 리랭킹 | Ollama (실패 시 RRF 폴백) | ✅ |

## 코드 변경 없이 동작하는 이유

기존 코드가 이미 오프라인을 지원합니다:

- **`auth/AuthService.ts`**: OAuth 미설정 시 `getAvailableProviders()`가 빈 배열 반환
- **`data/user-manager.ts`**: `ADMIN_PASSWORD` 환경변수로 `ensureAdminUser()` 관리자 자동 생성
- **`ollama/client.ts`**: `OLLAMA_HOST`가 로컬을 가리키면 외부 호출 없음
- **`domains/rag/EmbeddingService.ts`**: Ollama 로컬 모델로 임베딩
- **`domains/rag/Reranker.ts`**: Ollama 불가 시 RRF 결과로 폴백
- **`mcp/firecrawl.ts`**: API 키 없으면 도구 자체가 로드되지 않음
- **프론트엔드**: 모든 자산 self-hosted (Pretendard 폰트 포함 `vendor/pretendard/`)

## 검증

```bash
# 1. 헬스 체크
curl http://localhost:52416/api/health

# 2. 로컬 계정 로그인 확인

# 3. 채팅 기능 테스트 (Ollama 로컬 모델)

# 4. 문서 업로드 → RAG 기반 질의응답 테스트

# 5. OAuth 버튼이 UI에 표시되지 않는지 확인
```

## 오프라인 전환 체크리스트

- [ ] PostgreSQL 로컬 설치 + pgvector 확장 활성화
- [ ] Ollama 설치 + 모델 다운로드 (`mistral`, `nomic-embed-text`)
- [ ] `.env` 파일을 위의 오프라인 설정으로 구성
- [ ] OAuth 관련 환경변수 제거/주석처리
- [ ] `ADMIN_PASSWORD`, `JWT_SECRET`, `API_KEY_PEPPER` 설정
- [ ] `npm run build && npm start`
- [ ] `admin@localhost`로 로그인 확인
- [ ] 문서 업로드 → RAG 검색 동작 확인
