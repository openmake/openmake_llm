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
 * @property {string} href - 페이지 경로 (예: '/canvas.html')
 * @property {string} icon - 이모지 아이콘
 * @property {string} iconify - Iconify 아이콘 식별자
 * @property {string} label - 메뉴 표시 이름
 * @property {boolean} [requireAuth] - 인증 필요 여부
 * @property {boolean} [requireAdmin] - 관리자 권한 필요 여부
 */

/**
 * 네비게이션 항목 설정 객체
 * @type {{ menu: NavItem[], admin: NavItem[] }}
 */
const NAV_ITEMS = {
    menu: [
        { href: '/', icon: '💬', iconify: 'lucide:message-circle', label: '채팅' },
        { href: '/cluster.html', icon: '🖥️', iconify: 'lucide:monitor', label: '클러스터', requireAuth: true },
        { href: '/mcp-tools.html', icon: '🔧', iconify: 'lucide:wrench', label: 'MCP 도구' },
        { href: '/history.html', icon: '📜', iconify: 'lucide:scroll-text', label: '히스토리', requireAuth: true },
        { href: '/canvas.html', icon: '📄', iconify: 'lucide:file-text', label: '캔버스', requireAuth: true },
        { href: '/research.html', icon: '🔬', iconify: 'lucide:flask-conical', label: '딥 리서치', requireAuth: true },
        { href: '/documents.html', icon: '📑', iconify: 'lucide:file-search', label: '문서 관리', requireAuth: true },
        { href: '/marketplace.html', icon: '🏪', iconify: 'lucide:store', label: '마켓플레이스', requireAuth: true },
        { href: '/custom-agents.html', icon: '🤖', iconify: 'lucide:bot', label: '커스텀 에이전트', requireAuth: true },
        { href: '/skill-library.html', icon: '📦', iconify: 'lucide:package', label: '스킬 라이브러리', requireAuth: true, cssFiles: ['/css/skill-library.css'] },
        { href: '/memory.html', icon: '🧠', iconify: 'lucide:brain', label: 'AI 메모리', requireAuth: true },
        { href: '/usage.html', icon: '📈', iconify: 'lucide:bar-chart-2', label: 'API 사용량', requireAuth: true },
        { href: '/agent-learning.html', icon: '🎓', iconify: 'lucide:graduation-cap', label: '에이전트 학습', requireAuth: true },
        { href: '/guide.html', icon: '📖', iconify: 'lucide:book-open', label: '사용 가이드' },
        { href: '/api-keys.html', icon: '🔐', iconify: 'lucide:key', label: 'API 키 관리', requireAuth: true },
        { href: '/developer.html', icon: '📖', iconify: 'lucide:code-2', label: 'API 문서' }
    ],
    admin: [
        { href: '/admin.html', icon: '👥', iconify: 'lucide:users', label: '사용자 관리', requireAuth: true, requireAdmin: true },
        { href: '/admin-metrics.html', icon: '📊', iconify: 'lucide:bar-chart-3', label: '통합 모니터링', requireAuth: true, requireAdmin: true },
        { href: '/audit.html', icon: '📋', iconify: 'lucide:clipboard-list', label: '감사 로그', requireAuth: true, requireAdmin: true },
        { href: '/external.html', icon: '🔗', iconify: 'lucide:link', label: '외부 연동', requireAuth: true, requireAdmin: true },
        { href: '/analytics.html', icon: '📊', iconify: 'lucide:pie-chart', label: '분석 대시보드', requireAuth: true, requireAdmin: true },
        { href: '/alerts.html', icon: '🔔', iconify: 'lucide:bell', label: '알림 관리', requireAuth: true, requireAdmin: true },
        { href: '/password-change.html', icon: '🔑', iconify: 'lucide:key-round', label: '비밀번호 변경', requireAuth: true },
        { href: '/token-monitoring.html', icon: '🗝️', iconify: 'lucide:key-square', label: 'API 토큰 모니터링', requireAuth: true, requireAdmin: true },
        { href: '/settings.html', icon: '⚙️', iconify: 'lucide:settings', label: '설정', cssFiles: ['/css/settings.css'] }
    ]
};

// 전역 노출 (레거시 호환 — 페이지 모듈, 사이드바 등에서 참조)
window.NAV_ITEMS = NAV_ITEMS;

export { NAV_ITEMS };
