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
        { href: '/projects.html', icon: '📁', iconify: 'lucide:folder', label: '프로젝트', requireAuth: true },
        // /custom-agents.html, /skill-library.html, /mcp-servers.html: Phase R3 (2026-05-21) — /projects hub 로 통합
        // /usage.html, /api-keys.html: Phase R1 (2026-05-21) — settings 탭으로 통합
        { href: '/agent-learning.html', icon: '🎓', iconify: 'lucide:graduation-cap', label: '에이전트 학습', requireAuth: true, minTier: 'pro' }
        // /cluster.html: 2026-05-21 제거 — admin → 통합 모니터링 → "클러스터 노드 정보" section 과 중복
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
