/**
 * ============================================
 * SharedSidebar - 레거시 네비게이션 사이드바
 * ============================================
 * 모든 페이지에서 재사용 가능한 네비게이션 사이드바 컴포넌트입니다.
 * NAV_ITEMS 설정을 기반으로 메뉴/관리 섹션을 렌더링하고
 * 인증 상태에 따라 항목을 필터링합니다.
 * (UnifiedSidebar가 주 사이드바이며, 이 컴포넌트는 레거시 호환용)
 *
 * @module components/sidebar
 */

/**
 * 레거시 공유 사이드바 클래스
 * @class
 */
class SharedSidebar {
    /**
     * SharedSidebar 생성자
     * 현재 페이지 경로를 저장합니다.
     */
    constructor() {
        this.currentPage = window.location.pathname;
    }

    /**
     * 로그인 상태 확인 (OAuth 쿠키 세션 포함)
     * @returns {boolean} 로그인 여부
     */
    isLoggedIn() {
        const user = localStorage.getItem('user');
        return !!(user && user !== '{}' && user !== 'null');
    }

    /**
     * 게스트 모드 확인
     * @returns {boolean} 게스트 모드 여부
     */
    isGuestMode() {
        return localStorage.getItem('isGuest') === 'true';
    }

    /**
     * 인증된 사용자 확인 (로그인 사용자, 게스트 제외)
     * @returns {boolean} 인증 여부
     */
    isAuthenticated() {
        return this.isLoggedIn() && !this.isGuestMode();
    }

    /**
     * 인증 상태에 따라 필터링된 네비게이션 항목 반환
     * NAV_ITEMS 전역이 있으면 사용하고, 없으면 하드코딩된 폴백을 사용합니다.
     * @returns {Array<{section: string, items: Array}>} 섹션별 메뉴 항목 배열
     */
    getNavItems() {
        const isAuth = this.isAuthenticated();

        // NAV_ITEMS (nav-items.js)가 로드되어 있으면 사용, 아니면 폴백
        const navData = window.NAV_ITEMS || null;

        const menuItems = navData ? navData.menu.map(item => ({ ...item })) : [
            { href: '/', icon: '💬', label: '채팅' },
            { href: '/cluster.html', icon: '🖥️', label: '클러스터', requireAuth: true },
            { href: '/mcp-tools.html', icon: '🔧', label: 'MCP 도구' },
            { href: '/history.html', icon: '📜', label: '대화 히스토리', requireAuth: true },
            { href: '/canvas.html', icon: '📄', label: '캔버스', requireAuth: true },
            { href: '/research.html', icon: '🔬', label: '딥 리서치', requireAuth: true },
            { href: '/marketplace.html', icon: '🏪', label: '마켓플레이스', requireAuth: true },
            { href: '/custom-agents.html', icon: '🤖', label: '커스텀 에이전트', requireAuth: true },
            { href: '/memory.html', icon: '🧠', label: 'AI 메모리', requireAuth: true },
            { href: '/usage.html', icon: '📈', label: 'API 사용량', requireAuth: true },
            { href: '/agent-learning.html', icon: '🎓', label: '에이전트 학습', requireAuth: true },
            { href: '/guide.html', icon: '📖', label: '사용 가이드' }
        ];

        const adminItems = navData ? navData.admin.map(item => ({ ...item })) : [
            { href: '/admin.html', icon: '👥', label: '사용자 관리', requireAuth: true },
            { href: '/admin-metrics.html', icon: '📊', label: '통합 모니터링', requireAuth: true },
            { href: '/audit.html', icon: '📋', label: '감사 로그', requireAuth: true },
            { href: '/external.html', icon: '🔗', label: '외부 연동', requireAuth: true },
            { href: '/analytics.html', icon: '📊', label: '분석 대시보드', requireAuth: true },
            { href: '/alerts.html', icon: '🔔', label: '알림 관리', requireAuth: true },
            { href: '/password-change.html', icon: '🔑', label: '비밀번호 변경', requireAuth: true },
            { href: '/settings.html', icon: '⚙️', label: '설정' }
        ];

        // 인증 상태에 따라 필터링
        const filteredMenuItems = menuItems.filter(item => !item.requireAuth || isAuth);
        let filteredAdminItems = adminItems.filter(item => !item.requireAuth || isAuth);

        // 게스트/비로그인일 때: 설정만 남으면 메뉴 섹션으로 이동
        if (!isAuth && filteredAdminItems.length === 1 && filteredAdminItems[0].href === '/settings.html') {
            filteredMenuItems.push(filteredAdminItems[0]);
            filteredAdminItems = []; // 관리 섹션 비우기
        }

        const sections = [
            { section: '메뉴', items: filteredMenuItems }
        ];

        // 관리 섹션에 표시할 항목이 있는 경우에만 추가 (1개 이상의 관리 항목)
        if (filteredAdminItems.length > 0) {
            sections.push({ section: '관리', items: filteredAdminItems });
        }

        return sections;
    }

    isActive(href) {
        if (href === '/') {
            return this.currentPage === '/' || this.currentPage === '/index.html';
        }
        return this.currentPage === href;
    }

    getUserStatusHTML() {
        const isLoggedIn = this.isLoggedIn();
        const isGuest = this.isGuestMode();

        if (isLoggedIn && !isGuest) {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            return `
                <div class="user-status">
                    <span class="user-badge logged-in">👤 ${(function(s){var d=document.createElement('div');d.textContent=s||'사용자';return d.innerHTML;})(user.username)}</span>
                </div>
            `;
        } else if (isGuest) {
            return `
                <div class="user-status">
                    <span class="user-badge guest">👤 게스트</span>
                </div>
            `;
        } else {
            return `
                <div class="user-status">
                    <span class="user-badge not-logged-in">⚠️ 비로그인</span>
                </div>
            `;
        }
    }

    render(containerId = 'sidebar') {
        const container = document.getElementById(containerId);
        if (!container) return;

        const navSections = this.getNavItems().map(section => `
            <div class="nav-section">
                <div class="nav-section-title">${section.section}</div>
                ${section.items.map(item => `
                    <a href="${item.href}" class="nav-link ${this.isActive(item.href) ? 'active' : ''}" 
                       ${item.external ? 'target="_blank"' : ''}>
                        <span class="nav-icon">${item.icon}</span>
                        <span>${item.label}</span>
                    </a>
                `).join('')}
            </div>
        `).join('');

        const footerContent = this.isLoggedIn()
            ? `<a href="/login.html" class="nav-link" onclick="logout()">
                    <span class="nav-icon">🚪</span>
                    <span>로그아웃</span>
               </a>`
            : `<a href="/login.html" class="nav-link">
                    <span class="nav-icon">🔐</span>
                    <span>로그인</span>
               </a>`;

        container.innerHTML = `
            <div class="sidebar-header">
                <a href="/" class="sidebar-logo">
                    <img src="/logo.png" alt="Ollama">
                    <span>OpenMake.Ai</span>
                </a>
                <button class="sidebar-toggle" onclick="toggleSidebar()" title="사이드바 토글">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                    </svg>
                </button>
            </div>
            ${this.getUserStatusHTML()}
            <nav class="sidebar-nav">
                ${navSections}
            </nav>
            <div class="sidebar-footer">
                ${footerContent}
            </div>
        `;
    }
}

// 사이드바 토글
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    const menuBtn = document.querySelector('.mobile-menu-btn');
    const body = document.body;

    if (sidebar) {
        sidebar.classList.toggle('open');
        // 데스크탑에서는 collapsed 토글, 모바일에서는 open 토글만
        if (window.innerWidth > 768) {
            sidebar.classList.toggle('collapsed');
        }
    }

    if (window.innerWidth <= 768) {
        // 모바일 동작
        const isOpen = sidebar && sidebar.classList.contains('open');

        if (isOpen) {
            if (overlay) {
                overlay.style.display = 'block';
                setTimeout(() => overlay.classList.add('open'), 10);
            }
            if (menuBtn) menuBtn.classList.add('active');
            body.style.overflow = 'hidden'; // 스크롤 방지
        } else {
            if (overlay) {
                overlay.classList.remove('open');
                setTimeout(() => overlay.style.display = 'none', 300);
            }
            if (menuBtn) menuBtn.classList.remove('active');
            body.style.overflow = ''; // 스크롤 복원
        }
    }
}

// 모바일 사이드바 토글 (이벤트 핸들러용)
function toggleMobileSidebar(e) {
    if (e) e.preventDefault();
    toggleSidebar();
}

// 로그아웃 (🆕 서버 토큰 블랙리스트 연동 + AppState 정리)
function logout() {
     // 서버에 로그아웃 요청 (httpOnly 쿠키 포함)
     fetch('/api/auth/logout', {
         method: 'POST',
         credentials: 'include'  // 🔒 httpOnly 쿠키 포함
     }).catch(() => {});

    // localStorage 정리
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    localStorage.removeItem('isGuest');
    localStorage.removeItem('guestMode');

    // AppState 정리 — stale UI 방지 (auth.js의 logout과 동일)
    if (typeof window.setState === 'function') {
        window.setState('auth.authToken', null);
        window.setState('auth.currentUser', null);
        window.setState('auth.isGuestMode', false);
    }

    window.location.href = '/login.html';
}

// 테마 토글
function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

// 테마 초기화
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

// 페이지 접근 권한 체크 (제한된 페이지용)
function checkPageAccess(restrictedPages = []) {
    const currentPage = window.location.pathname;
    const user = localStorage.getItem('user');
    const isGuest = localStorage.getItem('isGuest') === 'true';
    const isAuthenticated = !!(user && user !== '{}' && user !== 'null') && !isGuest;

    if (restrictedPages.includes(currentPage) && !isAuthenticated) {
        // 제한된 페이지에 비인증 사용자가 접근 시 로그인 페이지로 리디렉션
        alert('이 페이지는 로그인이 필요합니다.');
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

// 사이드바 초기화
function initSidebar() {
    const sidebar = new SharedSidebar();
    sidebar.render('sidebar');
}

// DOM 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    initTheme();

    // 자동 초기화 (sidebar ID가 있는 경우)
    if (document.getElementById('sidebar')) {
        initSidebar();

        // 모바일 메뉴 버튼 터치 이벤트 추가
        const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('touchstart', (e) => toggleMobileSidebar(e), { passive: false });
        }

        // 오버레이 터치 이벤트
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) {
            overlay.addEventListener('touchstart', (e) => toggleMobileSidebar(e), { passive: false });
        }
    }
});

// 외부로 내보내기
window.SharedSidebar = SharedSidebar;
window.toggleSidebar = toggleSidebar;
window.toggleMobileSidebar = toggleMobileSidebar;
window.toggleTheme = toggleTheme;
window.logout = logout;
window.checkPageAccess = checkPageAccess;
