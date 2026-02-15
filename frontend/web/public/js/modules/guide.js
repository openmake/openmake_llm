/**
 * ============================================
 * Guide Module - 사용자 가이드 모달 렌더링
 * ============================================
 * GUIDE_DATA 전역 객체를 기반으로 사용자 가이드 모달을
 * 동적으로 생성합니다. 자동 감지 모드, 명령어 목록,
 * 프롬프트 모드 태그 등 섹션별 렌더링을 처리합니다.
 *
 * @module guide
 */

import { closeModal, openModal } from './ui.js';

/**
 * 사용자 가이드 모달을 동적으로 렌더링하여 표시
 * GUIDE_DATA 전역 객체에서 섹션 데이터를 읽어 HTML을 생성합니다.
 * auto_detect, commands, prompt_modes 섹션별로 다른 레이아웃을 적용합니다.
 * @returns {void}
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
 * @returns {void}
 */
function closeGuideModal() {
    closeModal('guideModal');
}

/**
 * 가이드에서 선택한 모드를 입력창에 /mode 명령어로 설정
 * 가이드 모달을 닫고 입력창에 포커스합니다.
 * @param {string} mode - 적용할 프롬프트 모드 이름
 * @returns {void}
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
