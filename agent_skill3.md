# Agent Skill 검색/필터 및 마켓플레이스 연동 구현 계획

> 작성일: 2026-02-22
> 기반 문서: `agent_skill2.md` (프로덕션 준비 완료 상태)
> 상태: **계획 수립 — 미구현**

---

## 1. 목표

기존 Agent Skill 시스템(CRUD + 에이전트 연결 + 시스템 프롬프트 주입)에 다음 기능을 추가한다:

1. **스킬 검색/필터 전용 페이지** — 사용자가 보유 스킬을 검색, 필터, 카테고리별 브라우징할 수 있는 독립 SPA 페이지
2. **SkillsMP 마켓플레이스 연동** — https://skillsmp.com/ko/search 에서 오픈소스 스킬을 검색하여 임포트하고, 로컬 스킬을 SKILL.md 포맷으로 익스포트

### 핵심 사용자 플로우

```
┌──────────────────────────────────────────────────────────────┐
│                    스킬 라이브러리 페이지                       │
│                                                              │
│  ┌─────────────────────┐  ┌──────────────────────────────┐   │
│  │   내 스킬 탭         │  │   마켓플레이스 탭              │   │
│  │                     │  │                              │   │
│  │  [검색창]           │  │  [SkillsMP 검색창]           │   │
│  │  [카테고리 필터]     │  │  [카테고리 필터]              │   │
│  │  [정렬 옵션]        │  │  [정렬 옵션]                 │   │
│  │                     │  │                              │   │
│  │  ┌─────────┐        │  │  ┌─────────┐                │   │
│  │  │ 스킬 카드 │ ...    │  │  │ 스킬 카드 │ ...           │   │
│  │  └────┬────┘        │  │  └────┬────┘                │   │
│  │       │             │  │       │                      │   │
│  │   [상세보기]         │  │   [미리보기] → [임포트]       │   │
│  │   [편집/삭제]        │  │                              │   │
│  │   [익스포트]         │  │                              │   │
│  └─────────────────────┘  └──────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 현행 시스템 분석 (agent_skill2.md 기준)

### 2.1 완료된 항목

| 영역 | 파일 | 상태 |
|------|------|------|
| DB 스키마 | `services/database/init/002-schema.sql` | ✅ `agent_skills`, `agent_skill_assignments` 테이블 |
| SkillManager | `backend/api/src/agents/skill-manager.ts` | ✅ CRUD + 연결 + buildSkillPrompt |
| 시스템 프롬프트 주입 | `backend/api/src/agents/system-prompt.ts` | ✅ 스킬 프롬프트 자동 주입 |
| ChatService 연동 | `backend/api/src/services/ChatService.ts` | ✅ 비동기 처리 정상 |
| 스킬 API 라우트 | `backend/api/src/routes/agents.routes.ts` | ✅ 7개 엔드포인트 |
| 프론트엔드 스킬 UI | `frontend/web/public/js/modules/pages/custom-agents.js` | ✅ 스킬 패널/모달/체크박스 |

### 2.2 현행 API 엔드포인트 (7종)

```
GET    /api/agents/skills                    → 전체 스킬 목록 (본인 + 공개)
POST   /api/agents/skills                    → 스킬 생성
PUT    /api/agents/skills/:skillId           → 스킬 수정
DELETE /api/agents/skills/:skillId           → 스킬 삭제
GET    /api/agents/:agentId/skills           → 에이전트 연결 스킬 조회
POST   /api/agents/:agentId/skills/:skillId  → 에이전트에 스킬 연결
DELETE /api/agents/:agentId/skills/:skillId  → 에이전트에서 스킬 해제
```

### 2.3 현행 시스템의 부족한 점 (이 계획에서 해결할 사항)

| 부족한 점 | 설명 |
|----------|------|
| 검색 없음 | `getAllSkills()`는 userId 기준 필터만 지원. 텍스트 검색, 카테고리 필터, 정렬 미지원 |
| 페이지네이션 없음 | 스킬 수가 늘어나면 전체 로드 방식은 성능 문제 |
| 전용 페이지 없음 | 스킬 관리가 `custom-agents.js` 내부 패널에 종속됨 |
| 상세 뷰 없음 | 스킬 카드 클릭 시 간단한 편집 모달만 있음. 미리보기/상세 없음 |
| 임포트/익스포트 없음 | SKILL.md 포맷 미지원, 외부 마켓플레이스 연동 없음 |
| 카테고리 제한 | `general`, `coding`, `writing`, `analysis`, `creative`, `education`, `business`, `science`만 존재 |

---

## 3. 구현 계획

### Phase 1: 백엔드 — 스킬 검색/필터 API 확장 (Priority: P0)

#### 3.1.1 SkillManager 검색 메서드 추가

**파일**: `backend/api/src/agents/skill-manager.ts`

새 메서드 `searchSkills()` 추가:

```typescript
export interface SkillSearchOptions {
    userId?: string;
    search?: string;       // 이름, 설명, 내용 텍스트 검색 (ILIKE)
    category?: string;     // 카테고리 필터
    isPublic?: boolean;    // 공개 스킬만 필터
    sortBy?: 'newest' | 'name' | 'category' | 'updated';  // 정렬
    limit?: number;        // 페이지네이션 (기본 20)
    offset?: number;       // 페이지네이션 오프셋
}

export interface SkillSearchResult {
    skills: AgentSkill[];
    total: number;         // 전체 매칭 수 (페이지네이션용)
    limit: number;
    offset: number;
}
```

구현 방향:
```typescript
async searchSkills(options: SkillSearchOptions): Promise<SkillSearchResult> {
    await this.ensureTables();
    const pool = this.getPool();

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    // 사용자 필터: 본인 스킬 + 공개 스킬
    if (options.userId) {
        conditions.push(`(created_by = $${paramIdx} OR is_public = TRUE)`);
        params.push(options.userId);
        paramIdx++;
    } else {
        conditions.push('is_public = TRUE');
    }

    // 텍스트 검색
    if (options.search) {
        conditions.push(`(name ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR content ILIKE $${paramIdx})`);
        params.push(`%${options.search}%`);
        paramIdx++;
    }

    // 카테고리 필터
    if (options.category) {
        conditions.push(`category = $${paramIdx}`);
        params.push(options.category);
        paramIdx++;
    }

    // 공개 스킬 필터
    if (options.isPublic !== undefined) {
        conditions.push(`is_public = $${paramIdx}`);
        params.push(options.isPublic);
        paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 정렬
    const sortMap: Record<string, string> = {
        newest: 'created_at DESC',
        name: 'name ASC',
        category: 'category ASC, name ASC',
        updated: 'updated_at DESC',
    };
    const orderBy = sortMap[options.sortBy ?? 'newest'] ?? 'created_at DESC';

    // 페이지네이션
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = options.offset ?? 0;

    // 카운트 쿼리
    const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM agent_skills ${whereClause}`,
        params
    );

    // 데이터 쿼리
    const dataResult = await pool.query(
        `SELECT id, name, description, content, category, is_public, created_by, created_at, updated_at
         FROM agent_skills ${whereClause}
         ORDER BY ${orderBy}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
    );

    return {
        skills: dataResult.rows.map((row: Record<string, unknown>) => this.rowToSkill(row)),
        total: parseInt(countResult.rows[0].total as string, 10),
        limit,
        offset,
    };
}
```

#### 3.1.2 스킬 검색 API 라우트 추가

**파일**: `backend/api/src/routes/agents.routes.ts`

기존 `GET /api/agents/skills`를 검색 파라미터 지원으로 확장:

```typescript
/**
 * GET /api/agents/skills
 * 스킬 검색/필터/페이지네이션
 * Query params: search, category, isPublic, sortBy, limit, offset
 */
router.get('/skills', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = (req as Request & { user?: { id: string } }).user?.id;
        const { search, category, isPublic, sortBy, limit, offset } = req.query;

        const result = await getSkillManager().searchSkills({
            userId,
            search: search ? String(search) : undefined,
            category: category ? String(category) : undefined,
            isPublic: isPublic !== undefined ? isPublic === 'true' : undefined,
            sortBy: sortBy ? String(sortBy) as 'newest' | 'name' | 'category' | 'updated' : undefined,
            limit: limit ? parseInt(String(limit), 10) : undefined,
            offset: offset ? parseInt(String(offset), 10) : undefined,
        });

        res.json(success(result));
    } catch (error) {
        logger.error('스킬 검색 실패:', error);
        res.status(500).json(internalError('스킬 검색 실패'));
    }
});
```

**주의사항**: 기존 `GET /api/agents/skills` 라우트를 수정하는 것이므로, 기존 프론트엔드(`custom-agents.js`)의 `loadSkills()` 호출이 깨지지 않도록 **하위 호환성**을 유지해야 한다. `search`, `category` 등 파라미터가 없으면 기존 동작(전체 목록 반환)과 동일하게 동작.

#### 3.1.3 스킬 카테고리 목록 API

```typescript
/**
 * GET /api/agents/skills/categories
 * 사용 가능한 카테고리 목록 (현재 DB에 존재하는 카테고리)
 */
router.get('/skills/categories', requireAuth, async (req: Request, res: Response) => {
    try {
        const pool = getSkillManager()['getPool']();
        const result = await pool.query(
            'SELECT DISTINCT category, COUNT(*) as count FROM agent_skills GROUP BY category ORDER BY count DESC'
        );
        res.json(success(result.rows));
    } catch (error) {
        res.status(500).json(internalError('카테고리 조회 실패'));
    }
});
```

**라우트 등록 순서 주의**: `/skills/categories`는 `/skills/:skillId`보다 **위에** 선언해야 `:skillId` 와일드카드에 매칭되지 않음.

---

### Phase 2: 백엔드 — SkillsMP 마켓플레이스 프록시 (Priority: P0)

#### 3.2.1 SkillsMP 연동 서비스

**새 파일**: `backend/api/src/services/SkillsMarketplaceService.ts`

SkillsMP(https://skillsmp.com)는 GitHub에서 수집한 261,000+ 오픈소스 에이전트 스킬의 마켓플레이스이다.
`SKILL.md` 오픈 표준 포맷을 사용하며, Anthropic이 수립하고 OpenAI가 채택한 형식이다.

```typescript
import { createLogger } from '../utils/logger';

const logger = createLogger('SkillsMarketplaceService');

export interface SkillsmpSearchOptions {
    query: string;         // 검색어
    category?: string;     // 카테고리 필터
    sort?: 'stars' | 'recent';  // 정렬
    limit?: number;        // 결과 수 (기본 20, 최대 50)
    offset?: number;       // 페이지네이션
}

export interface SkillsmpSkill {
    id: string;            // 고유 ID (GitHub repo + path)
    name: string;          // 스킬 이름
    description: string;   // 설명
    repo: string;          // GitHub 저장소 (예: "facebook/react")
    path: string;          // 스킬 파일 경로 (예: "SKILL.md")
    stars: number;         // GitHub 스타 수
    category: string;      // 카테고리
    content?: string;      // SKILL.md 원문 (상세 조회 시)
    updatedAt: string;     // 최종 업데이트
    url: string;           // SkillsMP 상세 URL
}

export interface SkillsmpSearchResult {
    skills: SkillsmpSkill[];
    total: number;
    query: string;
}

export class SkillsMarketplaceService {
    private readonly baseUrl = 'https://skillsmp.com';

    /**
     * SkillsMP에서 스킬 검색
     * SkillsMP의 API 또는 웹 스크래핑을 통해 검색 결과를 가져온다.
     *
     * 접근 전략 (우선순위):
     * 1. SkillsMP 공개 API가 있으면 직접 호출
     * 2. 없으면 GitHub API를 통해 SKILL.md 파일 검색 (GitHub Search API)
     * 3. 최후 수단: Firecrawl/웹 스크래핑 (프로젝트에 이미 Firecrawl 통합됨)
     */
    async searchSkills(options: SkillsmpSearchOptions): Promise<SkillsmpSearchResult> {
        // 구현 시 SkillsMP API 엔드포인트 확인 후 결정
        // 현재 skillsmp.com은 403 반환 → API 키 또는 다른 접근 방식 필요
        throw new Error('Not implemented');
    }

    /**
     * 특정 스킬의 SKILL.md 내용 가져오기
     * GitHub raw URL에서 직접 다운로드
     */
    async getSkillContent(repo: string, path: string): Promise<string> {
        const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${path}`;
        const response = await fetch(rawUrl);
        if (!response.ok) throw new Error(`Failed to fetch skill: ${response.status}`);
        return response.text();
    }

    /**
     * SKILL.md 포맷을 로컬 AgentSkill 형식으로 변환
     */
    parseSkillMd(content: string): { name: string; description: string; content: string; category: string } {
        // SKILL.md 파싱 로직
        // 일반적인 SKILL.md 구조:
        // # 스킬 이름
        // > 설명
        // ## Instructions
        // ... (스킬 내용)
        throw new Error('Not implemented');
    }

    /**
     * 로컬 스킬을 SKILL.md 포맷으로 변환 (익스포트용)
     */
    toSkillMd(skill: { name: string; description: string; content: string; category: string }): string {
        return [
            `# ${skill.name}`,
            '',
            `> ${skill.description}`,
            '',
            `**Category**: ${skill.category}`,
            '',
            '## Instructions',
            '',
            skill.content,
        ].join('\n');
    }
}

// 싱글톤
let instance: SkillsMarketplaceService | null = null;
export function getSkillsMarketplaceService(): SkillsMarketplaceService {
    if (!instance) instance = new SkillsMarketplaceService();
    return instance;
}
```

#### 3.2.2 SkillsMP 프록시 라우트

**새 파일**: `backend/api/src/routes/skills-marketplace.routes.ts`

프론트엔드에서 SkillsMP로 직접 호출 시 CORS 문제가 발생하므로 백엔드 프록시 필요.

```typescript
/**
 * GET /api/skills-marketplace/search
 * SkillsMP 스킬 검색 (프록시)
 * Query: query, category, sort, limit, offset
 */

/**
 * GET /api/skills-marketplace/detail
 * SkillsMP 스킬 상세 (SKILL.md 내용 포함)
 * Query: repo, path
 */

/**
 * POST /api/skills-marketplace/import
 * SkillsMP 스킬을 로컬 DB에 임포트
 * Body: { repo, path, name?, category? }
 * → SKILL.md 다운로드 → 파싱 → createSkill() 호출
 */

/**
 * GET /api/agents/skills/:skillId/export
 * 로컬 스킬을 SKILL.md 포맷으로 다운로드
 * Response: text/markdown (SKILL.md 파일)
 */
```

라우트 등록: `backend/api/src/routes/index.ts`에 추가

```typescript
import skillsMarketplaceRoutes from './skills-marketplace.routes';
router.use('/skills-marketplace', skillsMarketplaceRoutes);
```

#### 3.2.3 SkillsMP 접근 전략 상세

SkillsMP(`skillsmp.com`)는 GitHub에서 SKILL.md 파일을 수집하는 커뮤니티 프로젝트이다.
직접 API가 확인되지 않으므로 아래 전략을 단계별로 시도한다:

**전략 A — GitHub Search API 직접 사용 (권장)**
```
GET https://api.github.com/search/code?q=filename:SKILL.md+{검색어}
```
- 장점: 안정적, 공식 API, 레이트 리밋 관리 가능
- 단점: GitHub API 토큰 필요 (무인증 시 시간당 10회 제한)
- 구현: `.env`에 `GITHUB_TOKEN` 추가 (이미 GitHub OAuth 설정이 있으므로 토큰 재활용 가능)

**전략 B — SkillsMP 웹 스크래핑 (Firecrawl)**
```
POST /api/mcp/execute → firecrawl tool → https://skillsmp.com/ko/search?q={검색어}
```
- 장점: SkillsMP의 큐레이션/카테고리/평점 데이터 활용 가능
- 단점: 스크래핑 안정성 이슈, 사이트 구조 변경 시 깨짐
- 구현: 프로젝트에 이미 Firecrawl 통합되어 있음 (`backend/api/src/mcp/firecrawl.ts`)

**전략 C — SkillsMP iframe 임베딩 (최소 구현)**
```html
<iframe src="https://skillsmp.com/ko/search" ...></iframe>
```
- 장점: 구현 최소화, SkillsMP UI 그대로 활용
- 단점: CORS/CSP 정책으로 차단될 가능성 높음, UX 제어 불가

**권장**: 전략 A(GitHub Search API)를 기본으로, 전략 B(Firecrawl)를 SkillsMP 전용 보강 수단으로 병행.

---

### Phase 3: 프론트엔드 — 스킬 라이브러리 페이지 (Priority: P0)

#### 3.3.1 새 페이지 모듈 생성

**새 파일**: `frontend/web/public/js/modules/pages/skill-library.js`

기존 `marketplace.js`와 `custom-agents.js`의 패턴을 따르되, 스킬 전용 검색/필터/임포트/익스포트 기능을 제공하는 독립 페이지.

```javascript
/**
 * ============================================
 * Skill Library Page - 에이전트 스킬 라이브러리
 * ============================================
 * 에이전트 스킬의 검색, 필터, 관리, 외부 마켓플레이스
 * (SkillsMP) 연동을 제공하는 SPA 페이지 모듈입니다.
 *
 * @module pages/skill-library
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['skill-library'] = {
        getHTML: function() {
            // 탭: [내 스킬] [마켓플레이스]
            // 검색바: 텍스트 검색 + 카테고리 드롭다운 + 정렬 드롭다운
            // 스킬 그리드: 카드 형태로 표시
            // 모달: 스킬 상세, 편집, 임포트 확인
            return '...';  // 구현 시 HTML 구성
        },
        init: function() {
            // 탭 전환, 검색, 필터, 페이지네이션 로직
            // API 호출: GET /api/agents/skills?search=...&category=...
            // 마켓플레이스 탭: GET /api/skills-marketplace/search?query=...
        },
        cleanup: function() {
            // 타이머 정리, 글로벌 함수 제거
        }
    };
})();
```

#### 3.3.2 UI 구조 상세

```
┌────────────────────────────────────────────────────────────────────┐
│ 📦 스킬 라이브러리                                        [header] │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  [내 스킬]  [마켓플레이스(SkillsMP)]                     [탭 영역] │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 🔍 [검색어 입력...]   [카테고리 ▼]  [정렬: 최신순 ▼]       │  │
│  │                                         [+ 새 스킬] [내보내기]│  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ 🎯       │ │ 💻       │ │ 📊       │ │ 🔬       │             │
│  │ 스킬 A   │ │ 스킬 B   │ │ 스킬 C   │ │ 스킬 D   │             │
│  │ 코딩     │ │ 분석     │ │ 일반     │ │ 과학     │             │
│  │ 설명...  │ │ 설명...  │ │ 설명...  │ │ 설명...  │             │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ ...      │ │ ...      │ │ ...      │ │ ...      │             │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
│                                                                    │
│  ◀ 1 2 3 ... ▶                                     [페이지네이션] │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ [스킬 상세 모달]                                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 🎯 스킬 이름                                    [×]         │  │
│  │ 카테고리: 코딩  |  생성일: 2026-02-22  |  공개 여부: ✅      │  │
│  │                                                              │  │
│  │ 설명:                                                        │  │
│  │ 이 스킬은 코드 리뷰를 위한 전문 가이드라인을 제공합니다.      │  │
│  │                                                              │  │
│  │ ┌── 내용 미리보기 (마크다운 렌더링) ──┐                      │  │
│  │ │ ## Instructions                     │                      │  │
│  │ │ 1. 코드를 분석합니다                │                      │  │
│  │ │ 2. 보안 취약점을 확인합니다          │                      │  │
│  │ └─────────────────────────────────────┘                      │  │
│  │                                                              │  │
│  │ [편집] [복제] [에이전트에 연결] [SKILL.md 내보내기] [삭제]    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

마켓플레이스 탭 (SkillsMP):
```
┌────────────────────────────────────────────────────────────────────┐
│  [내 스킬]  [마켓플레이스(SkillsMP)] ← 활성                       │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 🔍 [SkillsMP 검색...]                      [카테고리 ▼]    │  │
│  │ ⓘ skillsmp.com 에서 261,000+ 오픈소스 스킬 검색              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ ⭐ 1.2k  │ │ ⭐ 890   │ │ ⭐ 456   │ │ ⭐ 234   │             │
│  │ flow.md  │ │ flags.md │ │ verify   │ │ lint     │             │
│  │ facebook │ │ facebook │ │ facebook │ │ eslint   │             │
│  │ /react   │ │ /react   │ │ /react   │ │ /eslint  │             │
│  │          │ │          │ │          │ │          │             │
│  │[미리보기]│ │[미리보기]│ │[미리보기]│ │[미리보기]│             │
│  │[임포트] │ │[임포트] │ │[임포트] │ │[임포트] │             │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
│                                                                    │
│  ◀ 1 2 3 ... ▶                                                    │
└────────────────────────────────────────────────────────────────────┘
```

#### 3.3.3 CSS 스타일

**기존 디자인 토큰**(`css/design-tokens.css`) 활용. 하드코딩 색상값 금지.

스킬 라이브러리 전용 스타일은 `getHTML()` 내부 `<style data-spa-style="skill-library">` 블록에 인라인 정의 (기존 페이지 패턴과 동일).

주요 스타일 컴포넌트:
- `.skill-library-search` — 검색바 (`.search-bar` 패턴 차용)
- `.skill-grid` — 그리드 레이아웃 (`grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`)
- `.skill-card` — 카드 (기존 `.agent-card` 패턴 차용)
- `.skill-detail-modal` — 상세 모달 (기존 `.modal-overlay` + `.modal` 패턴)
- `.pagination` — 페이지네이션 컨트롤
- `.marketplace-banner` — SkillsMP 안내 배너

#### 3.3.4 SPA 라우터 등록

**수정 파일**: `frontend/web/public/js/nav-items.js`

```javascript
// menu 배열에 추가 (custom-agents.html 아래)
{ href: '/skill-library.html', icon: '📦', iconify: 'lucide:package', label: '스킬 라이브러리', requireAuth: true },
```

**새 파일**: `frontend/web/public/skill-library.html`

SPA 라우터가 이 경로를 인식하고 `PageModules['skill-library']`를 로드할 수 있도록 HTML 셸 파일 생성 (기존 `marketplace.html` 등과 동일 패턴).

**수정 파일**: `frontend/web/public/index.html`

스크립트 로드 추가:
```html
<script src="/js/modules/pages/skill-library.js?v=12"></script>
```

---

### Phase 4: 임포트/익스포트 기능 상세 (Priority: P1)

#### 3.4.1 임포트 플로우

```
사용자가 마켓플레이스 탭에서 스킬 검색
    │
    ▼
SkillsMP/GitHub 검색 결과 표시 (스킬 카드 그리드)
    │
    ▼
사용자가 [미리보기] 클릭
    │
    ▼
GET /api/skills-marketplace/detail?repo={repo}&path={path}
    → GitHub Raw URL에서 SKILL.md 다운로드
    → 파싱된 내용 모달로 표시
    │
    ▼
사용자가 [임포트] 클릭
    │
    ▼
POST /api/skills-marketplace/import
    Body: { repo, path, name?, category? }
    │
    ▼
서버에서:
    1. GitHub Raw URL에서 SKILL.md 다운로드
    2. parseSkillMd()로 이름/설명/내용/카테고리 추출
    3. getSkillManager().createSkill()로 로컬 DB에 저장
    4. source_repo, source_path 메타데이터 저장 (출처 추적)
    │
    ▼
프론트엔드에 성공 응답 → 토스트 알림 + 내 스킬 탭으로 전환
```

#### 3.4.2 익스포트 플로우

```
사용자가 내 스킬 탭에서 스킬 상세 모달 열기
    │
    ▼
[SKILL.md 내보내기] 클릭
    │
    ▼
GET /api/agents/skills/{skillId}/export
    → Content-Type: text/markdown
    → Content-Disposition: attachment; filename="{name}.SKILL.md"
    │
    ▼
브라우저가 SKILL.md 파일 다운로드
```

#### 3.4.3 DB 스키마 확장 (임포트 출처 추적)

`agent_skills` 테이블에 선택적 컬럼 추가:

```sql
ALTER TABLE agent_skills
    ADD COLUMN IF NOT EXISTS source_repo TEXT,      -- 임포트 출처 GitHub 저장소
    ADD COLUMN IF NOT EXISTS source_path TEXT,      -- 임포트 출처 파일 경로
    ADD COLUMN IF NOT EXISTS source_url TEXT;        -- 임포트 출처 SkillsMP URL
```

`SkillManager`의 `ensureTables()`에도 동일하게 추가하여 런타임 자동 마이그레이션 보장.

---

### Phase 5: 기존 custom-agents.js 스킬 UI 연동 (Priority: P2)

기존 `custom-agents.js`의 스킬 패널은 유지하되, 스킬 라이브러리 페이지로 이동하는 링크를 추가:

```javascript
// custom-agents.js 내 스킬 관리 섹션에 링크 추가
'<a href="/skill-library.html" class="link-to-library">📦 전체 스킬 라이브러리 열기</a>'
```

이를 통해 두 페이지 간의 자연스러운 네비게이션 제공.

---

## 4. 파일 변경 목록 (전체)

### 새 파일

| 파일 | 설명 |
|------|------|
| `frontend/web/public/js/modules/pages/skill-library.js` | 스킬 라이브러리 SPA 페이지 모듈 |
| `frontend/web/public/skill-library.html` | SPA 라우터용 HTML 셸 |
| `backend/api/src/services/SkillsMarketplaceService.ts` | SkillsMP 연동 서비스 |
| `backend/api/src/routes/skills-marketplace.routes.ts` | SkillsMP 프록시 API 라우트 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `backend/api/src/agents/skill-manager.ts` | `searchSkills()` 메서드 추가, `SkillSearchOptions`/`SkillSearchResult` 인터페이스 추가, `source_repo`/`source_path`/`source_url` 필드 지원 |
| `backend/api/src/routes/agents.routes.ts` | `GET /skills` 검색 파라미터 확장, `GET /skills/categories` 추가, `GET /skills/:skillId/export` 추가 |
| `backend/api/src/routes/index.ts` | `skills-marketplace.routes.ts` 등록 |
| `frontend/web/public/js/nav-items.js` | 스킬 라이브러리 메뉴 항목 추가 |
| `frontend/web/public/index.html` | `skill-library.js` 스크립트 태그 추가 |
| `frontend/web/public/js/modules/pages/custom-agents.js` | 스킬 라이브러리 링크 추가 |
| `services/database/init/002-schema.sql` | `source_repo`, `source_path`, `source_url` 컬럼 추가 |

---

## 5. 미완료/미수정 코드 인벤토리 (agent_skill2.md 기준)

`agent_skill2.md`에서 확인된 완료 항목들을 재검증한 결과, 핵심 기능은 정상 구현되어 있으나 아래 사항들이 미해결 상태이다:

### 5.1 단위 테스트 미작성 (P1 — agent_skill2.md §4.1)

**현황**: `SkillManager`에 대한 단위 테스트가 없음.
**필요 테스트 목록**:

```typescript
// backend/api/src/__tests__/SkillManager.test.ts (미작성)

describe('SkillManager', () => {
    // CRUD
    it('should create a skill with valid input');
    it('should return null when updating non-existent skill');
    it('should delete skill and cascade assignments');
    it('should return skills filtered by userId');
    it('should return public skills for anonymous');

    // Assignment
    it('should assign skill to agent');
    it('should handle duplicate assignment (upsert)');
    it('should remove assignment');
    it('should return skills ordered by priority');

    // Prompt
    it('should build empty prompt for agent with no skills');
    it('should build prompt with multiple skills in priority order');

    // Search (Phase 1 신규)
    it('should search by text (name, description, content)');
    it('should filter by category');
    it('should paginate results');
    it('should sort by different criteria');
});
```

### 5.2 API 통합 테스트 미작성 (P1 — agent_skill2.md §4.1)

```typescript
// backend/api/src/__tests__/skills-api.test.ts (미작성)

describe('Skills API', () => {
    it('GET /api/agents/skills should return 401 without auth');
    it('GET /api/agents/skills should return skills array');
    it('POST /api/agents/skills should create skill');
    it('PUT /api/agents/skills/:id should update skill');
    it('DELETE /api/agents/skills/:id should delete skill');
    it('POST /api/agents/:agentId/skills/:skillId should assign');
    it('DELETE /api/agents/:agentId/skills/:skillId should unassign');
});
```

### 5.3 시스템 에이전트 스킬 UI 미지원 (P2 — agent_skill2.md §4.2)

**현황**: 커스텀 에이전트만 스킬 연결 가능. 시스템 기본 에이전트(coding, writing 등)에는 UI에서 스킬 연결 불가.
**계획**: 스킬 라이브러리 페이지의 상세 모달에서 "에이전트에 연결" 기능 구현 시, 시스템 에이전트도 선택 가능하도록 확장. 단, 시스템 에이전트 ID 목록은 `backend/api/src/agents/index.ts`의 AGENTS 상수에서 가져와야 함.

### 5.4 스킬 토큰 용량 예측 미구현 (P3 — agent_skill2.md §4.3)

**현황**: 스킬 content의 토큰 수가 시스템 프롬프트에 미치는 영향을 사전에 알 수 없음.
**계획**: 스킬 생성/편집 시 `content` 필드의 대략적 토큰 수를 계산하여 표시.
- 프론트엔드: 간단한 휴리스틱 (한글 1자 ≈ 2-3 토큰, 영문 1단어 ≈ 1-2 토큰)
- 또는 백엔드: `token-tracker.ts` 유틸 활용

### 5.5 custom-agents.js 스킬 UI의 소소한 개선 사항

현재 `custom-agents.js`의 스킬 관련 코드에서 확인된 개선 가능 사항:

1. **검색 없음**: `loadSkills()`가 전체 목록을 가져와서 렌더링. 스킬이 많아지면 UX 저하.
   → Phase 1에서 `searchSkills()` API 도입 시 자연스럽게 해결.

2. **카테고리 라벨 하드코딩**: `CAT_LABELS` 객체가 프론트엔드에 하드코딩됨.
   → Phase 1에서 `GET /api/agents/skills/categories` API 활용으로 전환 검토.

3. **스킬 모달에 삭제 확인이 `confirm()`**: 네이티브 confirm 대신 커스텀 모달 사용 검토.

---

## 6. 구현 순서 및 의존성

```
Phase 1 (P0)                          Phase 2 (P0)
백엔드 검색/필터 API 확장              SkillsMP 프록시 서비스
├── SkillManager.searchSkills()       ├── SkillsMarketplaceService
├── GET /skills?search=...            ├── GitHub API 연동
├── GET /skills/categories            ├── SKILL.md 파서
└── GET /skills/:id/export            └── skills-marketplace.routes.ts
        │                                      │
        └──────────────┬───────────────────────┘
                       │
                 Phase 3 (P0)
                 프론트엔드 스킬 라이브러리 페이지
                 ├── skill-library.js (IIFE 모듈)
                 ├── skill-library.html (셸)
                 ├── nav-items.js 수정
                 ├── index.html 스크립트 추가
                 └── 내 스킬 탭 + 마켓플레이스 탭
                       │
                 Phase 4 (P1)
                 임포트/익스포트 기능
                 ├── POST /skills-marketplace/import
                 ├── DB 스키마 source 컬럼 추가
                 └── 임포트/익스포트 UI
                       │
                 Phase 5 (P2)
                 기존 UI 연동 강화
                 ├── custom-agents.js 링크 추가
                 ├── 시스템 에이전트 스킬 UI
                 └── 토큰 용량 예측
```

---

## 7. 리스크 및 고려사항

| 리스크 | 영향 | 대응 |
|--------|------|------|
| SkillsMP API 비공개 | 마켓플레이스 검색 불가 | GitHub Search API로 대체 (전략 A) |
| GitHub API 레이트 리밋 | 시간당 10회 (미인증) / 30회 (인증) | GITHUB_TOKEN 설정, 결과 캐싱 (5분) |
| SKILL.md 포맷 비표준 변형 | 파싱 실패 | 관대한 파서 구현 + 수동 편집 폴백 |
| 대용량 스킬 content | 시스템 프롬프트 토큰 초과 | 토큰 용량 경고 표시 (§5.4) |
| 기존 GET /skills API 호환성 | custom-agents.js 깨짐 | 파라미터 없으면 기존 동작 유지 |
| XSS (스킬 content 렌더링) | 보안 취약 | `esc()` 함수로 모든 사용자 입력 이스케이프. `innerHTML` 직접 삽입 금지. 마크다운 렌더링 시 DOMPurify 또는 서버 사이드 렌더링 검토 |

---

## 8. 결론

이 계획은 기존 Agent Skill 시스템(agent_skill2.md에서 프로덕션 준비 완료 확인)의 자연스러운 확장이다:

1. **Phase 1-3 (P0)**: 스킬 검색/필터 API + 전용 페이지 + SkillsMP 프록시 — 핵심 기능
2. **Phase 4 (P1)**: 임포트/익스포트 — 마켓플레이스 연동의 실질적 가치
3. **Phase 5 (P2)**: 기존 UI 통합 + 시스템 에이전트 확장 — UX 완성도

총 **신규 4개 파일**, **수정 7개 파일**로 구성되며, 기존 코드와의 하위 호환성을 유지한다.
