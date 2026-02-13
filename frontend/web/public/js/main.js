/**
 * Main Entry Point
 * 앱 초기화 및 모듈 통합을 담당합니다.
 */

// 모듈 임포트 (ES6 모듈 지원 시)
// import { AppState, getState, setState } from './modules/state.js';
// import { initAuth, logout } from './modules/auth.js';
// import { connectWebSocket } from './modules/websocket.js';
// import { applyTheme, showSettings, closeSettings } from './modules/ui.js';
// import { sendMessage, newChat, useSuggestion } from './modules/chat.js';
// import { loadMCPSettings, loadPromptMode, loadAgentMode } from './modules/settings.js';
// import { showUserGuide, closeGuideModal } from './modules/guide.js';
// import { handleKeyDown } from './modules/utils.js';

/**
 * 앱 초기화
 * 🔒 Phase 3: async로 변경하여 initAuth() 완료까지 대기
 */
async function initApp() {
    if (typeof debugLog === 'function') debugLog('[App] 초기화 시작...');

    // 1. 인증 상태 초기화 (세션 복구 완료까지 대기)
    if (typeof initAuth === 'function') {
        await initAuth();
    }

    // 2. WebSocket 연결
    if (typeof connectWebSocket === 'function') {
        connectWebSocket();
    }

    // 3. 테마 적용
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (typeof applyTheme === 'function') {
        applyTheme(savedTheme);
    }

    // 4. 설정 로드
    if (typeof loadMCPSettings === 'function') {
        loadMCPSettings();
    }
    if (typeof loadPromptMode === 'function') {
        loadPromptMode();
    }
    if (typeof loadAgentMode === 'function') {
        loadAgentMode();
    }

    // 5. 이벤트 리스너 등록
    setupEventListeners();

    if (typeof debugLog === 'function') debugLog('[App] 초기화 완료');
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 텍스트 영역 자동 높이 조절
    const textarea = document.getElementById('chatInput');
    if (textarea) {
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        });
    }

    // 파일 드래그 앤 드롭
    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length > 0 && typeof handleFileUpload === 'function') {
                handleFileUpload(files);
            }
        });
    }

    // 파일 입력 변경
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0 && typeof handleFileUpload === 'function') {
                handleFileUpload(e.target.files);
            }
        });
    }

    // 채팅 입력 영역 드래그 앤 드롭 파일 업로드
    if (typeof setupChatDropZone === 'function') {
        setupChatDropZone();
    }

    // 모달 외부 클릭 시 닫기
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // 키보드 단축키
    document.addEventListener('keydown', (e) => {
        // Cmd/Ctrl + K: 새 대화
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            if (typeof newChat === 'function') {
                newChat();
            }
        }

        // Cmd/Ctrl + ,: 설정
        if ((e.metaKey || e.ctrlKey) && e.key === ',') {
            e.preventDefault();
            if (typeof showSettings === 'function') {
                showSettings();
            }
        }
    });
}

/**
 * 에이전트 목록 렌더링
 * @param {Array} agents - 에이전트 목록
 */
function renderAgentList(agents) {
    const list = document.getElementById('agentList');
    if (!list) return;

    if (!agents || agents.length === 0) {
        list.innerHTML = '<div class="agent-item-empty">등록된 에이전트 없음</div>';
        return;
    }

    list.innerHTML = agents.map(agent => `
        <div class="agent-item" title="${escapeHtml(agent.url)}">
            <span class="agent-icon">${agent.url.startsWith('local://') ? '🤖' : '🌐'}</span>
            <span class="agent-name">${escapeHtml(agent.name || agent.url.replace('local://', ''))}</span>
            <span class="agent-status-dot online"></span>
        </div>
    `).join('');
}

/**
 * 클러스터 정보 업데이트
 * @param {Object} data - 클러스터 데이터
 */
function updateClusterInfo(data) {
    if (data.nodes) {
        if (typeof setState === 'function') {
            setState('nodes', data.nodes);
        }
        updateSidebarClusterInfo();
    }
}

/**
 * 사이드바 클러스터 상태 업데이트
 */
function updateSidebarClusterInfo() {
    const nodes = typeof getState === 'function' ? getState('nodes') : [];
    const nodesListEl = document.getElementById('nodesList');

    if (!nodesListEl) return;

    if (!nodes || nodes.length === 0) {
        nodesListEl.innerHTML = '<div class="no-nodes">연결된 노드 없음</div>';
        return;
    }

    nodesListEl.innerHTML = nodes.map(node => `
        <div class="node-item ${node.status === 'online' ? 'online' : 'offline'}">
            <span class="node-status-dot ${node.status}"></span>
            <span class="node-name">${escapeHtml(node.name || node.id)}</span>
            ${node.latency ? `<span class="node-latency">${node.latency}ms</span>` : ''}
        </div>
    `).join('');
}

/**
 * 클러스터 이벤트 처리
 * @param {Object} event - 클러스터 이벤트
 */
function handleClusterEvent(event) {
    if (typeof debugLog === 'function') debugLog('[Cluster] 이벤트:', event.type);
    updateSidebarClusterInfo();
}

// 전역 노출
window.initApp = initApp;
window.renderAgentList = renderAgentList;
window.updateClusterInfo = updateClusterInfo;
window.updateSidebarClusterInfo = updateSidebarClusterInfo;
window.handleClusterEvent = handleClusterEvent;

// DOM 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
    // 레거시 app.js가 로드되지 않은 경우에만 초기화
    if (typeof window._appInitialized === 'undefined') {
        // initApp은 index.html에서 호출됨
    }
});
