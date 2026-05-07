---
name: postgres-raw-sql
description: OpenMake LLM의 PostgreSQL raw SQL 패턴. UnifiedDatabase 클래스, pg Pool, 파라미터화 쿼리, 스키마 자동 생성, 트랜잭션, 리트라이 래퍼. data/ 디렉토리 작업 시 필수. Use when writing SQL queries, modifying database schema, creating migrations, or working with the data layer.
---

# PostgreSQL Raw SQL Patterns — OpenMake LLM

이 프로젝트는 ORM 없이 raw SQL + pg Pool로 데이터베이스를 운영합니다.

## 핵심 구조

```
data/
├── models/
│   ├── unified-database.ts    # 메인 DB 클래스 (스키마 + CRUD)
│   └── token-blacklist.ts     # JWT 토큰 블랙리스트
├── conversation-db.ts         # 대화 CRUD
├── user-manager.ts            # 사용자 관리
├── retry-wrapper.ts           # 트랜잭션 + 리트라이 유틸리티
├── migrations/                # SQL 마이그레이션
├── seeds/                     # 시드 데이터
└── pipelines/                 # 데이터 파이프라인
```

## UnifiedDatabase 패턴

싱글턴 패턴, `getUnifiedDatabase()`로 접근:

```typescript
import { getUnifiedDatabase } from '../data/models/unified-database';

const db = getUnifiedDatabase();
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
```

## 타입 정의

```typescript
type QueryParam = string | number | boolean | null | undefined;
type DbRow = Record<string, unknown>;
```

## 스키마 (자동 생성)

서버 시작 시 `CREATE TABLE IF NOT EXISTS`로 자동 생성:

| 테이블 | 용도 | 주요 컬럼 |
|--------|------|----------|
| `users` | 사용자 | id(TEXT PK), username(UNIQUE), password_hash, role(CHECK), is_active |
| `conversation_sessions` | 대화 세션 | id(TEXT PK), user_id(FK), title, metadata(JSONB) |
| `conversation_messages` | 메시지 | id(SERIAL), session_id(FK CASCADE), role(CHECK), content, tokens |
| `api_usage` | API 사용량 | date, api_key_id, requests, tokens, UNIQUE(date,api_key_id) |
| `agent_usage_logs` | 에이전트 로그 | agent_id, user_id, response_time_ms, success |
| `agent_feedback` | 피드백 | agent_id, rating(CHECK 1-5), comment |
| `user_memories` | 장기 기억 | user_id(FK), category, content, importance |
| `research_sessions` | 리서치 | id, user_id, topic, status |
| `canvas_documents` | 캔버스 문서 | id, user_id, title, content(JSONB) |

## 쿼리 패턴 (필수 준수)

### 1. 항상 파라미터화 쿼리 사용
```typescript
// ✅ 올바름
await db.query('SELECT * FROM users WHERE email = $1', [email]);

// ❌ SQL 인젝션 위험
await db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

### 2. async/await 필수
```typescript
// ✅ 올바름
const result = await db.query('SELECT ...', []);

// ❌ 콜백 금지
db.query('SELECT ...', [], (err, res) => {});
```

### 3. 트랜잭션 패턴
```typescript
import { withTransaction } from '../data/retry-wrapper';

await withTransaction(async (client) => {
    await client.query('INSERT INTO ...', []);
    await client.query('UPDATE ...', []);
    // 자동 commit/rollback
});
```

### 4. 리트라이 래퍼
```typescript
import { withRetry } from '../data/retry-wrapper';

const result = await withRetry(() => db.query('SELECT ...', []), {
    maxRetries: 3,
    delay: 1000
});
```

### 5. JSONB 컬럼 활용
```typescript
// 저장
await db.query(
    'INSERT INTO conversation_sessions (id, metadata) VALUES ($1, $2)',
    [id, JSON.stringify({ model: 'gpt', tokens: 100 })]
);

// 조회 (JSONB 연산자)
await db.query(
    "SELECT * FROM conversation_sessions WHERE metadata->>'model' = $1",
    ['gpt']
);
```

### 6. TIMESTAMPTZ 사용
```typescript
// ✅ 항상 TIMESTAMPTZ (타임존 포함)
created_at TIMESTAMPTZ DEFAULT NOW()

// ❌ TIMESTAMP 사용 금지 (타임존 불일치)
```

## 마이그레이션 패턴

스키마 변경 시:
1. `data/models/unified-database.ts`의 SCHEMA 상수에 새 DDL 추가
2. `ALTER TABLE` 문은 `IF NOT EXISTS` / `IF EXISTS` 가드 포함
3. 기존 데이터 손실 없는 additive 변경만 허용

```typescript
// 안전한 마이그레이션 패턴
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

## 코딩 규칙

| 규칙 | 상세 |
|------|------|
| **ORM 금지** | Prisma, TypeORM, Drizzle 등 ORM 도입 금지. raw SQL만 사용 |
| **파라미터화 필수** | `$1, $2, ...` 플레이스홀더 사용. 문자열 보간 금지 |
| **async/await** | 모든 DB 호출은 async/await. 콜백/then 체인 금지 |
| **싱글턴 접근** | `getUnifiedDatabase()` 함수로만 DB 인스턴스 접근 |
| **에러 핸들링** | DB 에러는 retry-wrapper를 통해 재시도. 최종 실패 시 에러 전파 |
| **테스트** | `__tests__/unified-database.test.ts` (395줄) 기존 테스트 유지 |

## 체크리스트

새 테이블/쿼리 추가 시:
- [ ] `unified-database.ts` SCHEMA에 DDL 추가 (IF NOT EXISTS)
- [ ] 파라미터화 쿼리 확인 ($1, $2...)
- [ ] FOREIGN KEY + ON DELETE 정책 명시
- [ ] TIMESTAMPTZ 사용 (TIMESTAMP 아님)
- [ ] 인덱스 필요 여부 검토
- [ ] 기존 테스트 통과 확인
