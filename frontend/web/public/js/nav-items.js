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
        { href: '/', icon: '💬', iconify: 'lucide:message-circle', label: '채팅' },
        { href: '/history.html', icon: '📜', iconify: 'lucide:scroll-text', label: '히스토리', requireAuth: true },
        { href: '/guide.html', icon: '📖', iconify: 'lucide:book-open', label: '사용 가이드' },
        { href: '/developer.html', icon: '📖', iconify: 'lucide:code-2', label: 'API 문서' },
        { href: '/research.html', icon: '🔬', iconify: 'lucide:flask-conical', label: '딥 리서치', requireAuth: true, minTier: 'pro' },
        // /documents.html, /memory.html: 2026-05-19 제거
        { href: '/custom-agents.html', icon: '🤖', iconify: 'lucide:bot', label: '커스텀 에이전트', requireAuth: true, minTier: 'pro' },
        { href: '/skill-library.html', icon: '📦', iconify: 'lucide:package', label: '스킬 라이브러리', requireAuth: true, minTier: 'pro', cssFiles: ['/css/skill-library.css'] },
        { href: '/mcp-servers.html', icon: '🔌', iconify: 'lucide:plug', label: 'MCP 서버', requireAuth: true },
        // /usage.html, /api-keys.html: Phase R1 (2026-05-21) — settings 탭으로 통합
        { href: '/agent-learning.html', icon: '🎓', iconify: 'lucide:graduation-cap', label: '에이전트 학습', requireAuth: true, minTier: 'pro' },
        { href: '/cluster.html', icon: '🖥️', iconify: 'lucide:monitor', label: '클러스터', requireAuth: true, minTier: 'enterprise' }
    ],
    admin: [
        { href: '/admin.html', icon: '👥', iconify: 'lucide:users', label: '관리자', requireAuth: true, requireAdmin: true },
        // Phase R2 (2026-05-21): admin-metrics/audit/analytics/alerts/token-monitoring 5개 페이지를 /admin 의 섹션 탭으로 통합
        // /external.html: Phase R1 (2026-05-21) — settings 탭으로 통합
        // /password-change.html: Phase R1 (2026-05-21) — settings 탭으로 통합
        { href: '/settings.html', icon: '⚙️', iconify: 'lucide:settings', label: '설정', cssFiles: ['/css/settings.css?v=4'] }
    ]
};

// 전역 노출 (레거시 호환 — 페이지 모듈, 사이드바 등에서 참조)
window.NAV_ITEMS = NAV_ITEMS;

export { NAV_ITEMS };
