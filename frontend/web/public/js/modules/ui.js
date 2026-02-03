/**
 * UI Components Module
 * UI 컴포넌트 및 DOM 조작을 담당합니다.
 */

import { getState, setState } from './state.js';

/**
 * 테마 적용
 * @param {string} theme - 테마 (light, dark, system)
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
 * 테마 토글
 */
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
}

/**
 * 테마 설정
 * @param {string} theme - 테마
 */
function setTheme(theme) {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
    updateThemeButtonStates(theme);
}

/**
 * 테마 버튼 상태 업데이트
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
 * 사이드바 토글
 */
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

/**
 * 모바일 사이드바 토글
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
 * @param {string} modalId - 모달 ID
 */
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

/**
 * 모달 닫기
 * @param {string} modalId - 모달 ID
 */
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

/**
 * 설정 모달 열기
 */
function showSettings() {
    openModal('settingsModal');
    if (typeof loadCurrentModel === 'function') {
        loadCurrentModel();
    }
}

/**
 * 설정 모달 닫기
 */
function closeSettings() {
    closeModal('settingsModal');
}

/**
 * 파일 업로드 모달 열기
 */
function showFileUpload() {
    openModal('fileModal');
}

/**
 * 파일 업로드 모달 닫기
 */
function closeFileModal() {
    closeModal('fileModal');
}

/**
 * 토스트 알림 표시
 * @param {string} message - 메시지
 * @param {string} type - 타입 (success, error, info)
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
 * 에러 표시
 * @param {string} message - 에러 메시지
 */
function showError(message) {
    showToast(message, 'error');
}

/**
 * 스크롤 맨 아래로
 */
function scrollToBottom() {
    const chatArea = document.getElementById('chatArea');
    if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
}

/**
 * HTML 이스케이프
 * @param {string} str - 원본 문자열
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 마크다운 렌더링
 * @param {HTMLElement} element - 대상 요소
 * @param {string} text - 마크다운 텍스트
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
