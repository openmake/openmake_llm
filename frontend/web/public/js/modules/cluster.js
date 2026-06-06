/**
 * ============================================
 * Cluster - 클러스터 상태 및 모델 관리
 * ============================================
 * Ollama 클러스터 노드 정보 표시, 브랜드 모델 프로파일 셀렉트,
 * 에이전트 배지 표시를 담당합니다.
 *
 * app.js에서 추출됨 (L948-1120, L1515-1590, L3525-3626)
 *
 * @module cluster
 */

import { getState, setState } from './state.js';
import { escapeHtml, showToast } from './ui.js';
import { isAdmin } from './auth.js';
import { STORAGE_KEY_SELECTED_MODEL } from './constants.js';
import { fetchModelsPayload, pickDefaultModelId } from './models-api.js';

/**
 * 백엔드 /api/models 응답 캐시 (모듈 스코프)
 * @type {Array<{id: string, name: string, desc: string}> | null}
 */
let CACHED_MODELS = null;

/**
 * 백엔드에서 사용 가능한 모델 목록을 조회 (캐시됨)
 * @async
 * @returns {Promise<Array<{id: string, name: string, desc: string}>>}
 */
async function fetchAvailableModels() {
    if (CACHED_MODELS) return CACHED_MODELS;
    const payload = await fetchModelsPayload();
    if (!payload || payload.models.length === 0) return [];
    CACHED_MODELS = payload.models.map(m => ({
        id: m.modelId || m.name,
        name: m.name,
        desc: m.description || ''
    }));
    return CACHED_MODELS;
}

/**
 * 클러스터 노드 정보를 전역 상태에 반영하고 UI 업데이트
 * @param {Object} data - 클러스터 데이터
 * @returns {void}
 */
function updateClusterInfo(data) {
    if (!data) return;

    if (data.nodes) {
        setState('nodes', data.nodes);
        updateModelSelect();
        const nodes = getState('nodes') || [];
        const onlineCount = nodes.filter(n => n.status === 'online').length;
        updateClusterStatus(`${onlineCount} node online`, onlineCount > 0);
        updateSidebarClusterInfo();
    }
}

/**
 * 사이드바의 클러스터 상태 정보를 갱신
 * @returns {void}
 */
function updateSidebarClusterInfo() {
    const nodes = getState('nodes') || [];
    const clusterInfo = document.getElementById('clusterInfo');
    const nodesList = document.getElementById('nodesList');

    if (clusterInfo) {
        const onlineCount = nodes.filter(n => n.status === 'online').length;
        clusterInfo.textContent = `${nodes.length}개 노드 중 ${onlineCount}개 온라인`;
    }

    if (nodesList) {
        if (nodes.length > 0) {
            nodesList.innerHTML = nodes.map(n =>
                `<div style="margin: 4px 0; display: flex; align-items: center; gap: 8px;">
                    <span class="cluster-node-dot" data-status="${n.status === 'online' ? 'online' : 'offline'}">●</span>
                    <div>
                        <div style="font-weight: 500;">${escapeHtml(n.name || n.id)}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(n.host)}:${escapeHtml(String(n.port))}</div>
                    </div>
                </div>`
            ).join('');
            nodesList.querySelectorAll('.cluster-node-dot[data-status]').forEach(node => {
                node.style.color = node.dataset.status === 'online' ? '#22c55e' : '#ef4444';
            });
        } else {
            nodesList.innerHTML = '<div style="color: var(--text-muted);">노드 없음</div>';
        }
    }
}

/**
 * 클러스터 연결 상태 텍스트와 점 색상 업데이트
 * @param {string} text - 표시할 상태 텍스트
 * @param {boolean} online - 온라인 상태 여부
 * @returns {void}
 */
function updateClusterStatus(text, online) {
    const statusText = document.getElementById('clusterStatusText');
    const statusDot = document.querySelector('.status-dot');

    if (statusText) statusText.textContent = text;
    if (statusDot) {
        statusDot.classList.toggle('online', online);
        statusDot.classList.toggle('offline', !online);
    }
}

/**
 * REST API 폴백: WebSocket init 메시지가 도착하지 않을 때 클러스터 정보 가져오기
 * @async
 * @returns {Promise<void>}
 */
async function fetchClusterInfoFallback() {
    try {
        const response = await fetch(API_ENDPOINTS.CLUSTER, {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            updateClusterInfo(data);
        }
    } catch (error) {
        // REST API 폴백 실패 — 무시 (WebSocket이 주 채널)
    }
}

/**
 * 모델 선택 드롭다운 UI를 백엔드 응답 기반으로 업데이트
 * @async
 * @returns {Promise<void>}
 */
async function updateModelSelect() {
    const select = document.getElementById('modelSelect');
    if (!select) return;

    const isAdminUser = isAdmin();
    const models = await fetchAvailableModels();

    if (models.length === 0) {
        select.innerHTML = `<option value="">사용 가능한 모델 없음</option>`;
        return;
    }

    const defaultId = models[0].id;

    if (!isAdminUser) {
        const m = models[0];
        select.innerHTML = `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`;
        select.disabled = true;
        select.style.cursor = 'default';
        return;
    }

    select.disabled = false;
    select.style.cursor = 'pointer';

    const savedModel = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);
    const targetId = savedModel || defaultId;

    select.innerHTML = models.map(m => {
        const isSelected = m.id === targetId;
        return `<option value="${escapeHtml(m.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(m.name)}</option>`;
    }).join('');

    if (!savedModel && select.value) {
        localStorage.setItem('selectedModel', select.value);
    }

    // 초기 모델 capability 토글 동기화
    applyModelCapabilityToggles(select.value);

    select.onchange = function () {
        localStorage.setItem('selectedModel', this.value);
        const model = models.find(m => m.id === this.value);
        const displayName = model ? model.name : this.value;
        showToast(`모델 변경됨: ${displayName}`);
        applyModelCapabilityToggles(this.value);
    };
}

/**
 * 외부 provider 선택 시 Ollama 전용 기능 토글을 비활성화합니다.
 *
 * Phase 3.6 의 streamFromExternalProvider 는 strategies 를 우회하므로
 * Discussion / DeepResearch 모드는 외부 모델에서 동작하지 않습니다.
 * Thinking 은 Anthropic extended thinking 으로 매핑 가능하므로 활성 유지.
 *
 * @param {string} modelFullId - 'provider:model' 형식 (또는 bare ollama 모델명)
 */
function applyModelCapabilityToggles(modelFullId) {
    if (!modelFullId) return;

    // 외부 provider 식별 — KNOWN_FULLID_PREFIXES 와 동기화
    const colonIdx = modelFullId.indexOf(':');
    const prefix = colonIdx > 0 ? modelFullId.slice(0, colonIdx) : '';
    const isExternal = prefix === 'openrouter';

    const discussionBtn = document.getElementById('discussionModeBtn');
    const deepResearchBtn = document.getElementById('deepResearchBtn');

    [discussionBtn, deepResearchBtn].forEach((btn) => {
        if (!btn) return;
        if (isExternal) {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.title = '외부 provider(Anthropic / OpenAI 호환)에서는 미지원 — Ollama 모델에서만 동작';
            // 활성 상태였다면 해제
            btn.classList.remove('active');
        } else {
            btn.disabled = false;
            btn.style.opacity = '';
            btn.style.cursor = '';
            // 원래 title 복원 (data-original-title 패턴 미사용 — 인라인 fallback)
            if (btn.id === 'discussionModeBtn') btn.title = '멀티 에이전트 토론';
            else if (btn.id === 'deepResearchBtn') btn.title = 'Deep Research (심층 연구)';
        }
    });
}

// 글로벌 노출 — ModelSelector.setSelectedModel 에서 호출
window.applyModelCapabilityToggles = applyModelCapabilityToggles;

/**
 * 클러스터 이벤트 수신 시 노드 정보 새로고침 요청
 * @param {Object} event - 클러스터 이벤트 데이터
 * @returns {void}
 */
function handleClusterEvent(event) {
    const ws = getState('ws');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'refresh' }));
    }
}

/**
 * AI가 선택한 에이전트의 배지를 채팅 영역에 표시
 * @param {Object} agent - 에이전트 정보 객체
 * @returns {void}
 */
function showAgentBadge(agent) {
    setState('currentAgent', agent);

    const badgeContainer = document.getElementById('agentBadge');
    if (!badgeContainer) return;

    const phaseLabels = { planning: '분석 중...', build: '생성 중...', optimization: '최적화 중...' };
    const phaseStep = phaseLabels[agent.phase] || '처리 중...';
    const confidence = agent.confidence ? `신뢰도 ${Math.round(agent.confidence * 100)}%` : '';
    const reason = agent.reason || '';

    badgeContainer.innerHTML = `
        <div class="agent-status-toast">
            <span class="toast-agent-icon">${escapeHtml(agent.emoji || '🤖')}</span>
            <span class="toast-agent-name">${escapeHtml(agent.name || '에이전트')}</span>
            <span class="toast-step">${escapeHtml(phaseStep)}</span>
            ${confidence ? `<span class="toast-confidence">${escapeHtml(confidence)}</span>` : ''}
            ${reason ? `<span class="toast-reason">${escapeHtml(reason)}</span>` : ''}
        </div>
    `;
    badgeContainer.style.display = 'block';
}

/**
 * 모델을 선택하고 localStorage에 저장, UI 갱신
 * @async
 * @param {string} modelId - 선택할 모델 ID
 * @returns {Promise<void>}
 */
async function selectModel(modelId) {
    localStorage.setItem('selectedModel', modelId);
    loadModelInfo();

    const select = document.getElementById('modelSelect');
    if (select) {
        select.value = modelId;
    }

    const models = await fetchAvailableModels();
    const model = models.find(m => m.id === modelId);
    const displayName = model ? model.name : modelId;
    showToast(`모델 선택됨: ${displayName}`);
}

/**
 * LLM 모델 프로파일 목록을 서버에서 로드하여 설정 모달에 표시
 * @async
 * @returns {Promise<void>}
 */
async function loadModelInfo() {
    // ModelSelector(채팅 입력 영역) 가 모든 모델 변경 책임 — 본 함수는 settings modal 의
    // activeModelName read-only 표시만 유지. 변경 UI(modelListContainer badge) 는 제거됨.
    const activeModelName = document.getElementById('activeModelName');
    if (!activeModelName) return;

    activeModelName.textContent = '로딩 중...';

    try {
        const payload = await fetchModelsPayload();
        if (!payload) throw new Error('모델 API 응답 오류');

        if (payload.models.length === 0) {
            activeModelName.textContent = '모델 없음';
            return;
        }

        const savedModel = localStorage.getItem(STORAGE_KEY_SELECTED_MODEL);
        const defaultModelId = pickDefaultModelId(payload);
        const activeModel = payload.models.find(m => {
            const modelId = m.modelId || m.name;
            return savedModel ? modelId === savedModel : modelId === defaultModelId;
        }) || payload.models[0];
        activeModelName.textContent = activeModel.name;
    } catch (error) {
        console.error('[Settings] 모델 정보 조회 실패:', error);
        activeModelName.textContent = '연결 실패';
        modelListContainer.innerHTML = '<span style="color: var(--text-muted);">모델 목록을 가져올 수 없습니다</span>';
    }
}

/**
 * 바이트 수를 사람이 읽기 쉬운 크기 문자열로 변환
 * @param {number} bytes - 바이트 수
 * @returns {string} 포맷팅된 크기
 */
function formatSize(bytes) {
    if (!bytes) return '?';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)}GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)}MB`;
}

// 전역 노출 (레거시 호환)
window.updateClusterInfo = updateClusterInfo;
window.updateSidebarClusterInfo = updateSidebarClusterInfo;
window.updateClusterStatus = updateClusterStatus;
window.fetchClusterInfoFallback = fetchClusterInfoFallback;
window.updateModelSelect = updateModelSelect;
window.handleClusterEvent = handleClusterEvent;
window.showAgentBadge = showAgentBadge;
window.selectModel = selectModel;
window.loadModelInfo = loadModelInfo;
window.formatSize = formatSize;

export {
    updateClusterInfo,
    updateSidebarClusterInfo,
    updateClusterStatus,
    fetchClusterInfoFallback,
    updateModelSelect,
    handleClusterEvent,
    showAgentBadge,
    selectModel,
    loadModelInfo,
    formatSize
};
