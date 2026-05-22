/**
 * ============================================
 * Navigation Items - 사이드바 메뉴 데이터 소스
 * ============================================
 * 사이드바 메뉴 항목의 단일 소스 (Single Source of Truth).
 * index.html과 sidebar.js 모두 이 데이터를 참조합니다.
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
        { href: '/developer.html', icon: '📖', iconify: 'lucide:code-2', label: 'API 문서' },
        { href: '/research.html', icon: '🔬', iconify: 'lucide:flask-conical', label: '딥 리서치', requireAuth: true, minTier: 'pro' },
        // /documents.html, /memory.html: 2026-05-19 제거
        { href: '/projects.html', icon: '📁', iconify: 'lucide:folder', label: '프로젝트', requireAuth: true },
        // projects hub 의 3 카드 진입점 — 사이드바 nav 에서 hidden (projects 가 진입점), spa-router 라우트 등록 유지
        { href: '/skill-library.html', icon: '📦', iconify: 'lucide:package', label: '스킬 라이브러리', requireAuth: true, minTier: 'pro', cssFiles: ['/css/skill-library.css?v=5'], excludeFromSidebar: true },
        { href: '/mcp-servers.html', icon: '🔌', iconify: 'lucide:plug', label: 'MCP 서버', requireAuth: true, excludeFromSidebar: true },
        { href: '/custom-agents.html', icon: '🤖', iconify: 'lucide:bot', label: '커스텀 에이전트', requireAuth: true, minTier: 'pro', excludeFromSidebar: true },
        // /usage.html, /api-keys.html: Phase R1 (2026-05-21) — settings 탭으로 통합
        { href: '/agent-learning.html', icon: '🎓', iconify: 'lucide:graduation-cap', label: '에이전트 학습', requireAuth: true, minTier: 'pro' }
        // /cluster.html: 2026-05-21 제거 — admin → 통합 모니터링 → "클러스터 노드 정보" section 과 중복
    ],
    admin: [
        { href: '/admin.html', icon: '👥', iconify: 'lucide:users', label: '관리자', requireAuth: true, requireAdmin: true },
        // Phase R2 (2026-05-21): admin-metrics/audit/analytics/alerts/token-monitoring 5개 페이지를 /admin 의 섹션 탭으로 통합
        // settings 및 그 sub-탭들: 사이드바 nav 에서 hidden. settings 페이지의 톱니/avatar dropdown
        // 이 settings 진입점. settings 의 5탭 (account/api-keys/usage/integrations) 은 각자 페이지로
        // navigate 하므로 spa-router 라우트 등록 위해 entry 보존.
        { href: '/settings.html', icon: '⚙️', iconify: 'lucide:settings', label: '설정', cssFiles: ['/css/settings.css?v=4'], excludeFromSidebar: true },
        { href: '/password-change.html', icon: '🔑', iconify: 'lucide:key-round', label: '비밀번호 변경', requireAuth: true, excludeFromSidebar: true },
        { href: '/api-keys.html', icon: '🗝️', iconify: 'lucide:key', label: 'API 키', requireAuth: true, excludeFromSidebar: true },
        { href: '/usage.html', icon: '📈', iconify: 'lucide:bar-chart-2', label: '사용량', requireAuth: true, excludeFromSidebar: true },
        { href: '/external.html', icon: '🔗', iconify: 'lucide:link', label: '외부 연동', requireAuth: true, minTier: 'pro', excludeFromSidebar: true }
    ]
};

// 전역 노출 (레거시 호환 — 페이지 모듈, 사이드바 등에서 참조)
window.NAV_ITEMS = NAV_ITEMS;

export { NAV_ITEMS };
