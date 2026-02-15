/**
 * ============================================
 * UI Components - UI 유틸리티 및 DOM 조작
 * ============================================
 * 테마 관리(light/dark/system), 사이드바 토글, 모달 제어,
 * 토스트 알림, HTML 이스케이프, 마크다운 렌더링 등
 * 공통 UI 유틸리티 함수를 제공합니다.
 *
 * @module ui
 */

import { getState, setState } from './state.js';

/**
 * 테마 적용
 * system 모드인 경우 OS 설정(prefers-color-scheme)을 감지하여 자동 적용합니다.
 * @param {string} theme - 테마 ('light' | 'dark' | 'system')
 * @returns {void}
 */
function applyTheme(theme) {
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', theme);
    }
}

/**
 * 현재 테마를 dark/light 간 토글
 * localStorage에 설정을 저장합니다.
 * @returns {void}
 */
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
}

/**
 * 테마 설정 및 버튼 상태 동기화
 * localStorage에 저장하고 테마를 적용한 후 버튼 활성 상태를 업데이트합니다.
 * @param {string} theme - 테마 ('light' | 'dark' | 'system')
 * @returns {void}
 */
function setTheme(theme) {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    updateThemeButtonStates(theme);
}

/**
 * 테마 선택 버튼의 active 클래스 동기화
 * @param {string} theme - 현재 활성 테마
 * @returns {void}
 */
function updateThemeButtonStates(theme) {
    const buttons = ['theme-light', 'theme-dark', 'theme-system'];
    buttons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.classList.toggle('active', id === `theme-${theme}`);
        }
    });
}

/**
 * 데스크탑 사이드바 접기/펼치기 토글
 * @returns {void}
 */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

/**
 * 모바일 사이드바 열기/닫기 토글
 * 열기 시 배경 오버레이를 생성하고, 닫기 시 페이드아웃 후 제거합니다.
 * @returns {void}
 */
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const menuBtn = document.getElementById('mobileMenuBtn');

    if (sidebar && menuBtn) {
        sidebar.classList.toggle('open');
        menuBtn.classList.toggle('active');

        // 오버레이 배경 추가/제거
        let overlay = document.getElementById('mobile-overlay');
        if (sidebar.classList.contains('open')) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'mobile-overlay';
                overlay.className = 'mobile-overlay';
                overlay.onclick = toggleMobileSidebar;
                document.body.appendChild(overlay);
            }
            setTimeout(() => overlay.classList.add('active'), 10);
        } else if (overlay) {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        }
    }
}

/**
 * 모달 열기
 * 대상 요소에 'active' 클래스를 추가합니다.
 * @param {string} modalId - 열 모달의 DOM ID
 * @returns {void}
 */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

/**
 * 모달 닫기
 * 대상 요소에서 'active' 클래스를 제거합니다.
 * @param {string} modalId - 닫을 모달의 DOM ID
 * @returns {void}
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * 설정 모달 열기
 * 모달을 열고 현재 모델 설정을 로드합니다.
 * @returns {void}
 */
function showSettings() {
    openModal('settingsModal');
    if (typeof loadCurrentModel === 'function') {
        loadCurrentModel();
    }
}

/**
 * 설정 모달 닫기
 * @returns {void}
 */
function closeSettings() {
    closeModal('settingsModal');
}

/**
 * 파일 업로드 모달 열기
 * @returns {void}
 */
function showFileUpload() {
    openModal('fileModal');
}

/**
 * 파일 업로드 모달 닫기
 * @returns {void}
 */
function closeFileModal() {
    closeModal('fileModal');
}

/**
 * 토스트 알림 표시
 * 화면 하단 중앙에 2초간 표시 후 페이드아웃됩니다.
 * 기존 토스트가 있으면 제거 후 새로 생성합니다.
 * @param {string} message - 표시할 메시지 텍스트
 * @param {string} [type='info'] - 알림 타입 ('success' | 'error' | 'info')
 * @returns {void}
 */
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--accent-primary);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1100;
        animation: fadeIn 0.2s ease;
    `;

    if (type === 'error') {
        toast.style.background = 'var(--danger)';
    } else if (type === 'success') {
        toast.style.background = 'var(--success)';
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/**
 * 에러 토스트 표시 (showToast의 편의 래퍼)
 * @param {string} message - 에러 메시지 텍스트
 * @returns {void}
 */
function showError(message) {
    showToast(message, 'error');
}

/**
 * 채팅 영역을 맨 아래로 스크롤
 * 새 메시지 추가 시 자동 호출됩니다.
 * @returns {void}
 */
function scrollToBottom() {
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

/**
 * HTML 특수 문자 이스케이프
 * DOM 요소의 textContent를 활용한 안전한 이스케이프 처리입니다.
 * @param {string} str - 이스케이프할 원본 문자열
 * @returns {string} HTML 엔티티로 이스케이프된 문자열
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 마크다운 텍스트를 HTML로 렌더링
 * marked 라이브러리로 파싱 후 purifyHTML로 XSS 방어 처리합니다.
 * hljs가 로드되어 있으면 코드 블록 구문 강조도 적용합니다.
 * marked가 없으면 일반 텍스트로 폴백합니다.
 * @param {HTMLElement} element - 렌더링 대상 DOM 요소
 * @param {string} text - 마크다운 원본 텍스트
 * @returns {void}
 */
function renderMarkdown(element, text) {
    if (typeof marked !== 'undefined') {
        try {
            marked.setOptions({
                breaks: true,
                gfm: true
            });
            element.innerHTML = window.purifyHTML(marked.parse(text));
            element.classList.add('markdown-body');

            // 코드 하이라이팅
            if (typeof hljs !== 'undefined') {
                element.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
        } catch (e) {
            console.error('Markdown parse error:', e);
            element.textContent = text;
        }
    } else {
        element.textContent = text;
    }
}

// 시스템 테마 변경 감지
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (localStorage.getItem('theme') === 'system') {
        applyTheme('system');
    }
});

// 전역 노출 (레거시 호환)
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.setTheme = setTheme;
window.toggleSidebar = toggleSidebar;
window.toggleMobileSidebar = toggleMobileSidebar;
window.openModal = openModal;
window.closeModal = closeModal;
window.showSettings = showSettings;
window.closeSettings = closeSettings;
window.showFileUpload = showFileUpload;
window.closeFileModal = closeFileModal;
window.showToast = showToast;
window.showError = showError;
window.scrollToBottom = scrollToBottom;
window.escapeHtml = escapeHtml;
window.renderMarkdown = renderMarkdown;

export {
    applyTheme,
    toggleTheme,
    setTheme,
    toggleSidebar,
    toggleMobileSidebar,
    openModal,
    closeModal,
    showSettings,
    closeSettings,
    showFileUpload,
    closeFileModal,
    showToast,
    showError,
    scrollToBottom,
    escapeHtml,
    renderMarkdown
};
