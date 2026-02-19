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

/**
 * 브랜드 모델 프로파일 정의 (backend pipeline-profile.ts와 동기화)
 * @type {Array<{id: string, name: string, desc: string}>}
 */
const BRAND_MODELS = [
    { id: 'openmake_llm_auto', name: 'OpenMake LLM Auto', desc: '자동 라우팅' },
    { id: 'openmake_llm', name: 'OpenMake LLM', desc: '균형 잡힌 범용' },
    { id: 'openmake_llm_pro', name: 'OpenMake LLM Pro', desc: '프리미엄 품질' },
    { id: 'openmake_llm_fast', name: 'OpenMake LLM Fast', desc: '속도 최적화' },
    { id: 'openmake_llm_think', name: 'OpenMake LLM Think', desc: '심층 추론' },
    { id: 'openmake_llm_code', name: 'OpenMake LLM Code', desc: '코드 전문' },
    { id: 'openmake_llm_vision', name: 'OpenMake LLM Vision', desc: '멀티모달' },
];

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
                    <span style="color: ${n.status === 'online' ? '#22c55e' : '#ef4444'}">●</span>
                    <div>
                        <div style="font-weight: 500;">${escapeHtml(n.name || n.id)}</div>
                        <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(n.host)}:${escapeHtml(String(n.port))}</div>
                    </div>
                </div>`
            ).join('');
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
        const response = await fetch('/api/cluster', {
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
 * 모델 선택 드롭다운 UI를 브랜드 모델 프로파일로 업데이트
 * @returns {void}
 */
function updateModelSelect() {
    const select = document.getElementById('modelSelect');
    if (!select) return;

    const isAdminUser = isAdmin();

    if (!isAdminUser) {
        select.innerHTML = '<option value="openmake_llm_auto">OpenMake LLM Auto</option>';
        select.disabled = true;
        select.style.cursor = 'default';
        return;
    }

    select.disabled = false;
    select.style.cursor = 'pointer';

    const savedModel = localStorage.getItem('selectedModel');
    const defaultModelId = 'openmake_llm_auto';

    select.innerHTML = BRAND_MODELS.map(m => {
        const isSelected = savedModel ? m.id === savedModel : m.id === defaultModelId;
        return `<option value="${escapeHtml(m.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(m.name)}</option>`;
    }).join('');

    if (!savedModel && select.value) {
        localStorage.setItem('selectedModel', select.value);
    }

    select.onchange = function () {
        localStorage.setItem('selectedModel', this.value);
        const brandModel = BRAND_MODELS.find(m => m.id === this.value);
        const displayName = brandModel ? brandModel.name : this.value;
        showToast(`🤖 모델 변경됨: ${displayName}`);
    };
}

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

    const phaseColors = { planning: '#f59e0b', build: '#22c55e', optimization: '#3b82f6' };
    const phaseLabels = { planning: '기획', build: '구현', optimization: '최적화' };

    badgeContainer.innerHTML = `
        <div class="agent-badge-content" style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 20px; background: var(--bg-card); border: 2px solid var(--border-light); box-shadow: 2px 2px 0 #000; font-size: 0.85rem; animation: slideUp 0.3s ease-out;">
            <span style="font-size: 1.2rem;">${agent.emoji || '🤖'}</span>
            <div style="display: flex; flex-direction: column;">
                <span style="font-weight: 600; color: var(--text-primary);">${escapeHtml(agent.name || '에이전트')}</span>
                <span style="font-size: 0.7rem; color: var(--text-secondary);">${escapeHtml(agent.reason || '')}</span>
            </div>
            ${agent.phase ? `<span style="font-size: 0.65rem; padding: 2px 6px; background: ${phaseColors[agent.phase] || '#6b7280'}22; border: 1px solid ${phaseColors[agent.phase] || '#6b7280'}; border-radius: 8px; color: ${phaseColors[agent.phase] || '#6b7280'}; font-weight: 500;">${phaseLabels[agent.phase] || agent.phase}</span>` : ''}
        </div>
    `;
    badgeContainer.style.display = 'block';
}

/**
 * 모델을 선택하고 localStorage에 저장, UI 갱신
 * @param {string} modelId - 선택할 브랜드 모델 ID
 * @returns {void}
 */
function selectModel(modelId) {
    localStorage.setItem('selectedModel', modelId);
    loadModelInfo();

    const select = document.getElementById('modelSelect');
    if (select) {
        select.value = modelId;
    }

    const brandModel = BRAND_MODELS.find(m => m.id === modelId);
    const displayName = brandModel ? brandModel.name : modelId;
    showToast(`🤖 모델 선택됨: ${displayName}`);
}

/**
 * LLM 모델 프로파일 목록을 서버에서 로드하여 설정 모달에 표시
 * @async
 * @returns {Promise<void>}
 */
async function loadModelInfo() {
    const activeModelName = document.getElementById('activeModelName');
    const modelListContainer = document.getElementById('modelListContainer');
    if (!activeModelName || !modelListContainer) return;

    const isAdminUser = isAdmin();

    if (!isAdminUser) {
        activeModelName.textContent = 'OpenMake LLM Auto';
        modelListContainer.innerHTML = '<span style="color: var(--text-muted);">모델 정보는 관리자만 볼 수 있습니다</span>';
        return;
    }

    activeModelName.textContent = '로딩 중...';
    modelListContainer.innerHTML = '<span style="color: var(--text-muted);">조회 중...</span>';

    try {
        const response = await fetch('/api/models', { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            const payload = data.data || data;

            const savedModel = localStorage.getItem('selectedModel');
            const defaultModelId = payload.defaultModel || 'openmake_llm_auto';

            let activeDisplayName = 'OpenMake LLM Auto';
            if (payload.models && payload.models.length > 0) {
                const activeModel = payload.models.find(m => {
                    const modelId = m.modelId || m.name;
                    return savedModel ? modelId === savedModel : modelId === defaultModelId;
                });
                if (activeModel) activeDisplayName = activeModel.name;
            }
            activeModelName.textContent = activeDisplayName;

            if (payload.models && payload.models.length > 0) {
                modelListContainer.innerHTML = payload.models.map(model => {
                    const modelId = model.modelId || model.name;
                    const displayName = model.name;
                    const isActive = savedModel ? modelId === savedModel : modelId === defaultModelId;
                    return `
                        <div class="model-badge ${isActive ? 'active' : ''}" onclick="selectModel('${escapeHtml(modelId)}')">
                            ${isActive ? '✓ ' : ''}${escapeHtml(displayName)}
                        </div>
                    `;
                }).join('');
            } else {
                modelListContainer.innerHTML = '<span style="color: var(--text-muted);">사용 가능한 모델 없음</span>';
            }
        } else {
            throw new Error('모델 API 응답 오류');
        }
    } catch (error) {
        console.error('[Settings] 모델 정보 조회 실패:', error);
        activeModelName.textContent = 'OpenMake LLM Auto';
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
window.BRAND_MODELS = BRAND_MODELS;
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
    BRAND_MODELS,
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
