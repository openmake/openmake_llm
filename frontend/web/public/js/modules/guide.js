/**
 * Guide Module
 * 사용자 가이드 모달을 담당합니다.
 */

import { closeModal, openModal } from './ui.js';

/**
 * 사용자 가이드 표시
 */
function showUserGuide() {
    const modal = document.getElementById('guideModal');
    const body = document.getElementById('guideBody');
    const title = document.getElementById('guideTitle');
    const footer = document.getElementById('guideFooter');

    if (!modal || !body || typeof GUIDE_DATA === 'undefined') {
        console.error('Guide data or modal elements not found');
        return;
    }

    // 데이터 기반 동적 렌더링
    title.textContent = `📖 ${GUIDE_DATA.title}`;
    footer.textContent = GUIDE_DATA.footer;

    let html = '';
    GUIDE_DATA.sections.forEach(section => {
        html += `
            <div class="guide-section">
                <div class="guide-section-title">${section.title}</div>
                <div class="guide-section-desc">${section.description}</div>
        `;

        if (section.id === 'auto_detect') {
            html += `<div class="guide-grid">`;
            section.items.forEach(item => {
                html += `
                    <div class="guide-card" onclick="useMode('${item.mode}')">
                        <div class="guide-card-icon">${item.icon}</div>
                        <div class="guide-card-content">
                            <div class="guide-card-label">${item.label}</div>
                            <div class="guide-card-example">${item.example}</div>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        } else if (section.id === 'commands') {
            html += `<div class="guide-command-list">`;
            section.items.forEach(item => {
                html += `
                    <div class="guide-command-item">
                        <div class="guide-command-code">${item.cmd}</div>
                        <div class="guide-command-desc">${item.desc}</div>
                    </div>
                `;
            });
            html += `</div>`;
        } else if (section.id === 'prompt_modes') {
            html += `<div class="guide-mode-tags">`;
            section.modes.forEach(mode => {
                html += `<span class="guide-mode-tag" onclick="useMode('${mode}')">${mode}</span>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
    });

    body.innerHTML = html;
    modal.classList.add('active');
}

/**
 * 가이드 모달 닫기
 */
function closeGuideModal() {
    closeModal('guideModal');
}

/**
 * 모드 사용
 * @param {string} mode - 모드 이름
 */
function useMode(mode) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = `/mode ${mode}`;
        closeGuideModal();
        input.focus();
    }
}

// 전역 노출 (레거시 호환)
window.showUserGuide = showUserGuide;
window.closeGuideModal = closeGuideModal;
window.useMode = useMode;

export {
    showUserGuide,
    closeGuideModal,
    useMode
};
