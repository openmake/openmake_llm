/**
 * ============================================
 * Shared Navigation Items Data Source
 * 
 * 사이드바 메뉴 항목의 단일 소스 (Single Source of Truth)
 * index.html과 sidebar.js 모두 이 데이터를 사용합니다.
 * 
 * 새 페이지 추가 시 이 파일만 수정하면 됩니다.
 * ============================================
 */

const NAV_ITEMS = {
    menu: [
        { href: '/', icon: '💬', iconify: 'lucide:message-circle', label: '채팅' },
        { href: '/cluster.html', icon: '🖥️', iconify: 'lucide:monitor', label: '클러스터', requireAuth: true },
        { href: '/mcp-tools.html', icon: '🔧', iconify: 'lucide:wrench', label: 'MCP 도구' },
        { href: '/history.html', icon: '📜', iconify: 'lucide:scroll-text', label: '히스토리', requireAuth: true },
        { href: '/canvas.html', icon: '📄', iconify: 'lucide:file-text', label: '캔버스', requireAuth: true },
        { href: '/research.html', icon: '🔬', iconify: 'lucide:flask-conical', label: '딥 리서치', requireAuth: true },
        { href: '/marketplace.html', icon: '🏪', iconify: 'lucide:store', label: '마켓플레이스', requireAuth: true },
        { href: '/custom-agents.html', icon: '🤖', iconify: 'lucide:bot', label: '커스텀 에이전트', requireAuth: true },
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
        { href: '/settings.html', icon: '⚙️', iconify: 'lucide:settings', label: '설정' }
    ]
};

// 전역 노출
window.NAV_ITEMS = NAV_ITEMS;
