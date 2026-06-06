/**
 * ============================================
 * Navigation Items - 사이드바 메뉴 데이터 소스
 * ============================================
 * 사이드바 메뉴 항목의 단일 소스 (Single Source of Truth).
 * components/unified-sidebar.js 가 이 데이터를 참조하여 렌더링합니다.
 * 새 페이지 추가 시 이 파일만 수정하면 됩니다.
 *
 * @module nav-items
 */

/**
 * @typedef {Object} NavItem
 * @property {string} href - 페이지 경로 (예: '/research.html')
 * @property {string} icon - 이모지 아이콘
 * @property {string} iconify - Iconify 아이콘 식별자
 * @property {string} label - 메뉴 표시 이름
 * @property {boolean} [requireAuth] - 인증 필요 여부
 * @property {boolean} [requireAdmin] - 관리자 권한 필요 여부
 * @property {string} [minTier] - 최소 필요 티어 ('pro' | 'enterprise')
 */

/**
 * 네비게이션 항목 설정 객체
 * @type {{ menu: NavItem[], admin: NavItem[] }}
 */
const NAV_ITEMS = {
    menu: [
        // / (채팅): 2026-05-21 제거 — 사이드바 상단의 "새 대화" 버튼 + 로고 클릭이 채팅 진입 경로 대체
        { href: '/history.html', icon: '📜', iconify: 'lucide:scroll-text', label: '히스토리', requireAuth: true },
        // /guide.html: 2026-05-21 제거 — 사용 가이드 전체 시스템 폐기
        // /developer.html (API 문서): 2026-06-02 settings 탭으로 이전 — nav 제거, 라우트는 spa-router 에 보존
        { href: '/research.html', icon: '🔬', iconify: 'lucide:flask-conical', label: '딥 리서치', requireAuth: true, minTier: 'pro' },
        { href: '/agent-tasks.html', icon: '🤖', iconify: 'lucide:bot', label: '에이전트 작업', requireAuth: true },
        // /documents.html, /memory.html: 2026-05-19 제거
        // /projects.html (프로젝트): 2026-06-02 settings 탭으로 이전 — nav 제거, 라우트는 spa-router 에 보존
        // projects hub 의 2 카드 진입점 — 사이드바 nav 에서 hidden (projects 가 진입점), spa-router 라우트 등록 유지
        { href: '/skill-library.html', icon: '📦', iconify: 'lucide:package', label: '스킬 라이브러리', requireAuth: true, minTier: 'pro', cssFiles: ['/css/skill-library.css?v=15'], excludeFromSidebar: true },
        { href: '/mcp-servers.html', icon: '🔌', iconify: 'lucide:plug', label: 'MCP 서버', requireAuth: true, cssFiles: ['/css/skill-library.css?v=15'], excludeFromSidebar: true },
        // 2026-05-26: 기존 '커스텀 에이전트' CRUD 페이지 → Git URL Ingest 'Agent Draft' 검토 전용으로 재포지셔닝.
        // 사용자 본인 페르소나(Custom Agent)는 Settings '사용자 지시문' 아래 '내 Agent' 섹션으로 일원화 (2026-06-01).
        { href: '/custom-agents.html', icon: '📥', iconify: 'lucide:inbox', label: 'Agent Draft', requireAuth: true, excludeFromSidebar: true },
        // /my-agents.html standalone 페이지 폐기 (2026-06-01) — pages/my-agents.js 모듈은 Settings 임베드용으로 유지.
        // /usage.html, /api-keys.html: Phase R1 (2026-05-21) — settings 탭으로 통합
        { href: '/agent-learning.html', icon: '🎓', iconify: 'lucide:graduation-cap', label: '에이전트 학습', requireAuth: true, minTier: 'pro' }
        // /cluster.html: 2026-05-21 제거 — admin → 통합 모니터링 → "클러스터 노드 정보" section 과 중복
    ],
    admin: [
        // dashboard.css: 2026-06-03 복원 — Phase R2 통합 시 누락된 link. admin.js(사용자)/admin-metrics(통합 모니터링)의
        // .dashboard-grid·.metric-card·.node-grid 등이 이 CSS 의존. 라우트 이탈 시 removeModuleCSS 로 unload 되어 non-admin 페이지 무영향.
        { href: '/admin.html', icon: '👥', iconify: 'lucide:users', label: '관리자', requireAuth: true, requireAdmin: true, cssFiles: ['/css/pages/dashboard.css?v=12'] },
        // MCP 카탈로그/모니터링: 2026-06-03 admin 섹션 탭(/admin.html?tab=mcp-catalog|mcp-monitoring)으로 흡수 — Phase R2 완성.
        // 사이드바 nav 에서 hidden, standalone 라우트는 spa-router 직접 접근/북마크용으로 보존.
        { href: '/admin-mcp-catalog.html', icon: '🔌', iconify: 'lucide:server-cog', label: 'MCP 카탈로그', requireAuth: true, requireAdmin: true, excludeFromSidebar: true },
        { href: '/admin-mcp-monitoring.html', icon: '📊', iconify: 'lucide:activity', label: 'MCP 모니터링', requireAuth: true, requireAdmin: true, excludeFromSidebar: true },
        // Phase R2 (2026-05-21): admin-metrics/audit/analytics/alerts/token-monitoring 5개 페이지를 /admin 의 섹션 탭으로 통합
        // settings 및 그 sub-탭들: 사이드바 nav 에서 hidden. settings 페이지의 톱니/avatar dropdown
        // 이 settings 진입점. settings 의 5탭 (account/api-keys/usage/integrations) 은 각자 페이지로
        // navigate 하므로 spa-router 라우트 등록 위해 entry 보존.
        { href: '/settings.html', icon: '⚙️', iconify: 'lucide:settings', label: '설정', cssFiles: ['/css/settings.css?v=17'], excludeFromSidebar: true },
        { href: '/password-change.html', icon: '🔑', iconify: 'lucide:key-round', label: '비밀번호 변경', requireAuth: true, excludeFromSidebar: true },
        { href: '/api-keys.html', icon: '🗝️', iconify: 'lucide:key', label: 'API 키', requireAuth: true, excludeFromSidebar: true },
        { href: '/usage.html', icon: '📈', iconify: 'lucide:bar-chart-2', label: '사용량', requireAuth: true, excludeFromSidebar: true },
        { href: '/external.html', icon: '🔗', iconify: 'lucide:link', label: '외부 연동', requireAuth: true, minTier: 'pro', excludeFromSidebar: true }
    ]
};

// 전역 노출 (레거시 호환 — 페이지 모듈, 사이드바 등에서 참조)
window.NAV_ITEMS = NAV_ITEMS;

export { NAV_ITEMS };
