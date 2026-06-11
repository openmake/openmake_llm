/**
 * ============================================
 * Chat Module - 채팅 메시지 전송 및 오케스트레이션
 * ============================================
 * WebSocket 기반 실시간 채팅 메시지 전송, 응답 중단(abort),
 * 전송 버튼 상태 관리를 담당합니다.
 * DOM 렌더링은 chat-renderer.js, 사용자 액션은 chat-actions.js에 위임합니다.
 *
 * @module chat
 */

import { getState, setState, addToMemory } from './state.js';
import { sendWsMessage } from './websocket.js';
import { STORAGE_KEY_GENERAL_SETTINGS, STORAGE_KEY_SELECTED_MODEL, STORAGE_KEY_USER } from './constants.js';

// 하위 모듈 import
import { addChatMessage, appendToken, appendThinkingToken, finishAssistantMessage, setHideAbortButton } from './chat-renderer.js';
import { copyMessage, regenerateMessage, sendFeedback, newChat, useSuggestion, setSendMessage } from './chat-actions.js';

// SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
const SS = window.SafeStorage;

// 전송 버튼의 원본 SVG (abort 모드 해제 시 복원용)
const SEND_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
const ABORT_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

/** 스크린 리더용 상태 공지 (P1-14 접근성) */
function announceA11y(message) {
    const el = document.getElementById('a11y-announcer');
    if (!el) return;
    // 동일 메시지 반복 시에도 aria-live 트리거 되도록 빈 값 후 설정
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
}

/**
 * AI 응답 생성 중단 요청
 * WebSocket을 통해 서버에 abort 메시지를 전송하고 UI를 업데이트합니다.
 * @returns {void}
 */
function abortChat() {
    if (!getState('isGenerating')) return;

    console.log('[Chat] 응답 생성 중단 요청');
    sendWsMessage({ type: 'abort' });

    setState('isGenerating', false);
    hideAbortButton();
}

/**
 * 전송 버튼을 중단 모드로 전환
 * 전송 버튼의 스타일과 동작을 abort 모드로 변경합니다.
 * @returns {void}
 */
function showAbortButton() {
    const sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) return;

    sendBtn.classList.add('abort-mode');
    sendBtn.innerHTML = ABORT_ICON_SVG;
    sendBtn.title = '응답 생성 중단';
    announceA11y('AI가 응답을 생성하고 있습니다.');
}

/**
 * 전송 버튼을 원래 상태로 복원
 * @returns {void}
 */
function hideAbortButton() {
    const sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) return;

    sendBtn.classList.remove('abort-mode');
    sendBtn.innerHTML = SEND_ICON_SVG;
    sendBtn.title = '전송 (Enter)';
    announceA11y('AI 응답이 완료되었습니다.');
}

/**
 * Phase 3-A (2026-05-26): slash command 처리.
 * 지원: /remember <사실>, /forget <id|all>, /memories
 * 처리됨 (true 반환) 시 caller 는 LLM 호출 스킵.
 *
 * @param {string} message - 사용자 입력
 * @returns {Promise<boolean>} 처리 여부
 */
async function handleSlashCommand(message) {
    const m = message.trim();
    const showToast = window.showToast || function(t){ console.log(t); };

    // /remember <fact>
    if (m === '/remember' || m === '/remember help') {
        addChatMessage('assistant', '사용법: `/remember <기억할 사실>` — 예: `/remember 나는 한국어로 답변 받기를 선호함`\n다른 명령: `/memories` (목록), `/forget all` (전체 삭제), `/forget <id>` (개별 삭제)');
        return true;
    }
    if (m.startsWith('/remember ')) {
        const content = m.slice('/remember '.length).trim();
        if (!content) { showToast('기억할 내용을 입력하세요', 'error'); return true; }
        try {
            const res = await window.authFetch('/api/users/me/memories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = (data && data.error && data.error.message) || '저장 실패';
                addChatMessage('assistant', `${msg}`);
                return true;
            }
            addChatMessage('assistant', `기억했습니다: "${content}"\n이후 모든 대화에서 이 사실이 system prompt 에 prepend 됩니다.`);
        } catch (e) {
            addChatMessage('assistant', `저장 실패: ${e.message || e}`);
        }
        return true;
    }

    // /memories — 목록
    if (m === '/memories') {
        try {
            const res = await window.authFetch('/api/users/me/memories');
            const data = await res.json();
            const memories = (data && data.data && data.data.memories) || [];
            if (!memories.length) {
                addChatMessage('assistant', '저장된 memory 가 없습니다. `/remember <사실>` 로 추가하세요.');
                return true;
            }
            const lines = memories.map((m, i) => `${i + 1}. \`${m.id.slice(0, 8)}\` — ${m.content}`).join('\n');
            addChatMessage('assistant', `저장된 memory (${memories.length}개):\n${lines}`);
        } catch (e) {
            addChatMessage('assistant', `조회 실패: ${e.message || e}`);
        }
        return true;
    }

    // /forget all / /forget <id-prefix>
    if (m === '/forget all') {
        if (!confirm('모든 memory 를 삭제하시겠습니까?')) return true;
        try {
            const res = await window.authFetch('/api/users/me/memories', { method: 'DELETE' });
            const data = await res.json();
            const count = (data && data.data && data.data.deleted) || 0;
            addChatMessage('assistant', `${count}개 memory 삭제됨.`);
        } catch (e) {
            addChatMessage('assistant', `삭제 실패: ${e.message || e}`);
        }
        return true;
    }
    if (m.startsWith('/forget ')) {
        const idPrefix = m.slice('/forget '.length).trim();
        if (!idPrefix) return true;
        try {
            // ID prefix 매칭 위해 우선 list 조회 → 해당 id 찾기
            const listRes = await window.authFetch('/api/users/me/memories');
            const listData = await listRes.json();
            const memories = (listData && listData.data && listData.data.memories) || [];
            const target = memories.find(m => m.id.startsWith(idPrefix));
            if (!target) { addChatMessage('assistant', `id prefix "${idPrefix}" 와 일치하는 memory 없음`); return true; }
            const res = await window.authFetch('/api/users/me/memories/' + encodeURIComponent(target.id), { method: 'DELETE' });
            if (!res.ok) { addChatMessage('assistant', '삭제 실패'); return true; }
            addChatMessage('assistant', `삭제됨: "${target.content}"`);
        } catch (e) {
            addChatMessage('assistant', `삭제 실패: ${e.message || e}`);
        }
        return true;
    }

    return false;  // 미인식 slash command — 일반 메시지로 처리
}

/**
 * 사용자 메시지 전송
 * 입력창 내용과 첨부 파일을 WebSocket을 통해 서버에 전송합니다.
 * 모델 선택, 웹 검색, 사고 모드, 문서 컨텍스트 등 옵션을 포함합니다.
 * @returns {Promise<void>}
 */
// ── Stage 3: 채팅 내 에이전트 작업 라우팅 (백엔드 채팅 파이프라인 미경유, agent-task API 재사용) ──
function _renderAgentTaskCard(t) {
    const labels = { pending: '대기중', running: '진행중', completed: '완료', failed: '실패', cancelled: '취소' };
    const esc = (s) => { const d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; };
    let html = '<div class="agent-task-chat-card" style="border:1px solid var(--border-light);border-radius:8px;padding:12px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<iconify-icon icon="lucide:bot"></iconify-icon><strong>에이전트 작업</strong>' +
        '<span style="margin-left:auto;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--bg-tertiary);">' + (labels[t.status] || esc(t.status)) + '</span></div>' +
        '<div style="color:var(--text-secondary);font-size:13px;">' + esc(t.goal) + '</div>';
    if (t.progress > 0 && t.status === 'running') {
        html += '<div style="height:5px;background:var(--bg-tertiary);border-radius:3px;margin-top:8px;overflow:hidden;"><div style="height:100%;background:var(--accent-primary);width:' + t.progress + '%;transition:width .3s;"></div></div>';
    }
    // result 의 [[artifact:id]] 플레이스홀더 제거 — 결과물은 배지 + 상세 모달에서 확인
    const cleanedResult = String(t.result || '').replace(/\[\[artifact:[^\]]+\]\]/g, '').trim();
    if (cleanedResult) html += '<div style="margin-top:8px;white-space:pre-wrap;font-size:14px;line-height:1.6;">' + esc(cleanedResult) + '</div>';
    if (t.artifactCount > 0) {
        html += '<div style="margin-top:8px;padding:8px 10px;background:var(--bg-tertiary);border-radius:6px;font-size:13px;color:var(--text-primary);">' +
            '<iconify-icon icon="lucide:file-text"></iconify-icon> 결과물 ' + t.artifactCount + '개 — 카드를 클릭해 확인하세요</div>';
    }
    if (t.error) html += '<div style="margin-top:8px;color:var(--danger);font-size:13px;">' + esc(t.error) + '</div>';
    html += '<div style="margin-top:8px;"><a href="/agent-tasks.html" style="font-size:12px;color:var(--accent-primary);">작업 페이지에서 단계 보기 →</a></div></div>';
    return html;
}

function _ensureChatTaskProgressHandler() {
    // 채팅 전용 슬롯 — agent-tasks 페이지의 window.onAgentTaskProgress 와 분리 (덮어쓰기/cleanup null 충돌 방지)
    window.onAgentTaskProgressChat = function(p) {
        if (!p || !p.taskId) return;
        const card = document.querySelector('[data-agent-task-id="' + p.taskId + '"]');
        if (!card) return;
        const content = card.querySelector('.message-content') || card;
        const goal = card.dataset.agentTaskGoal || '';
        const terminal = (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled');
        if (terminal) {
            // 완료/실패/취소 — 결과를 가져와 카드에 직접 표시 (WS payload엔 result가 없음)
            window.authFetch('/api/agent-tasks/' + p.taskId).then(r => r.json()).then(res => {
                const t = (res.data && res.data.task) || {};
                const steps = (res.data && res.data.steps) || [];
                const artifactCount = steps.filter(s => s.step_type === 'artifact').length;
                content.innerHTML = _renderAgentTaskCard({ status: p.status, progress: 100, goal: goal, result: t.result, error: t.error, artifactCount: artifactCount });
            }).catch(() => {
                content.innerHTML = _renderAgentTaskCard({ status: p.status, progress: 100, goal: goal });
            });
        } else {
            content.innerHTML = _renderAgentTaskCard({ status: p.status, progress: p.progress, goal: goal });
        }
    };
}

/**
 * 채팅 작업 카드 클릭 → 작업 페이지로 이동 + 해당 작업 상세 모달 자동 오픈 (딥링크).
 * 카드 어디를 눌러도 결과를 재확인할 수 있게 한다. taskId 는 클릭 시점의 dataset 에서 읽는다.
 */
function _attachAgentTaskCardClick(cardDiv) {
    cardDiv.style.cursor = 'pointer';
    cardDiv.addEventListener('click', function (e) {
        const id = cardDiv.dataset.agentTaskId;
        if (!id) return;
        try { sessionStorage.setItem('pendingAgentTaskId', id); } catch (_e) { /* storage 차단 환경 무시 */ }
        if (e.target.closest('a')) return; // 내부 링크는 라우터 기본 동작 (pendingId 만 저장)
        if (window.Router && typeof window.Router.navigate === 'function') window.Router.navigate('/agent-tasks.html');
        else location.href = '/agent-tasks.html';
    });
}

async function _startAgentTaskFromChat(goal) {
    _ensureChatTaskProgressHandler();
    const cardDiv = addChatMessage('assistant', '');
    _attachAgentTaskCardClick(cardDiv);
    cardDiv.dataset.agentTaskGoal = goal;
    const content = cardDiv.querySelector('.message-content');
    if (content) content.innerHTML = _renderAgentTaskCard({ status: 'pending', progress: 0, goal: goal });
    try {
        const created = await window.authFetch('/api/agent-tasks', { method: 'POST', body: JSON.stringify({ goal: goal }) }).then(r => r.json());
        const task = (created.data && created.data.task) || created.data;
        if (!task || !task.id) throw new Error('생성 실패');
        cardDiv.dataset.agentTaskId = task.id;
        if (content) content.innerHTML = _renderAgentTaskCard({ status: 'running', progress: 1, goal: goal });
        const execRes = await window.authFetch('/api/agent-tasks/' + task.id + '/execute', { method: 'POST' });
        if (!execRes.ok) throw new Error('실행 요청 실패 (HTTP ' + execRes.status + ')');
    } catch (e) {
        console.error('[Chat] 에이전트 작업 시작 실패:', e);
        if (content) content.innerHTML = _renderAgentTaskCard({ status: 'failed', progress: 0, goal: goal, error: '작업 시작에 실패했습니다' });
    }
}

/**
 * 새로고침/재방문 시 진행 중(running) 에이전트 작업 카드를 채팅 영역에 복원합니다.
 * 카드 복원 후 WS 진행 이벤트(onAgentTaskProgressChat)가 이어서 갱신하므로
 * 새로고침으로 카드가 사라져도 진행과정을 계속 확인할 수 있습니다.
 */
async function restoreRunningAgentTaskCards() {
    if (typeof window.authFetch !== 'function') return;
    try {
        const res = await window.authFetch('/api/agent-tasks');
        if (!res.ok) return; // 미인증/게스트 등 — 조용히 스킵
        const body = await res.json();
        const tasks = (body.data && body.data.tasks) || [];
        const running = tasks.filter(t => t.status === 'running');
        if (running.length === 0) return;
        _ensureChatTaskProgressHandler();
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        for (const t of running) {
            // 이미 카드가 있으면 중복 생성 금지 (SPA 재진입 등)
            if (document.querySelector('[data-agent-task-id="' + t.id + '"]')) continue;
            const cardDiv = addChatMessage('assistant', '');
            _attachAgentTaskCardClick(cardDiv);
            cardDiv.dataset.agentTaskId = t.id;
            cardDiv.dataset.agentTaskGoal = t.goal || '';
            const content = cardDiv.querySelector('.message-content');
            if (content) content.innerHTML = _renderAgentTaskCard({ status: t.status, progress: t.progress || 0, goal: t.goal || '' });
        }
    } catch (e) {
        console.error('[Chat] 에이전트 작업 카드 복원 실패:', e);
    }
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    const attachedFiles = getState('attachedFiles');

    // 중복 전송 방지
    if (getState('isSending')) return;
    if (!message && attachedFiles.length === 0) return;

    setState('isSending', true);

    // Phase 3-A (2026-05-26): slash command 처리 — /remember, /forget, /memories
    // chat 흐름과 분리, LLM 호출 없음. claude.ai/ChatGPT Memory 동등.
    if (message.startsWith('/')) {
        const handled = await handleSlashCommand(message);
        if (handled) {
            input.value = '';
            input.style.height = 'auto';
            setState('isSending', false);
            return;
        }
    }

    // 환영 화면 숨기기
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    // 사용자 메시지 추가
    addChatMessage('user', message);
    // saveHistory 설정이 활성화된 경우에만 메모리에 저장
    const generalSettingsForHistory = JSON.parse(SS.getItem(STORAGE_KEY_GENERAL_SETTINGS) || '{}');
    if (generalSettingsForHistory.saveHistory !== false) {
        addToMemory('user', message);
    }

    // 입력창 초기화
    input.value = '';
    input.style.height = 'auto';

    // 에이전트 작업 모드 — ws chat 대신 백그라운드 자율 작업으로 라우팅 (채팅 파이프라인 미경유)
    if (getState('agentTaskMode')) {
        await _startAgentTaskFromChat(message);
        setState('isSending', false);
        return;
    }

    // AI 응답 메시지 생성
    const assistantDiv = addChatMessage('assistant', '');
    setState('currentAssistantMessage', assistantDiv);
    setState('currentAssistantMessageContent', assistantDiv.querySelector('.message-content'));
    setState('messageStartTime', Date.now());
    setState('isGenerating', true);

    // 중단 버튼 표시
    showAbortButton();

    try {
        // WebSocket으로 메시지 전송
        const payload = {
            type: 'chat',
            message: message,
            // 빈 model은 백엔드가 자동 선택 (ws-chat-handler.ts: !model || model === 'default' → selectOptimalModel)
            model: document.getElementById('modelSelect')?.value || SS.getItem(STORAGE_KEY_SELECTED_MODEL) || '',
            history: getState('conversationMemory'),
            webSearch: getState('webSearchEnabled') || (getState('mcpToolsEnabled') || {}).web_search === true,
            thinkingMode: getState('thinkingEnabled'),
            thinkingLevel: getState('thinkingLevel') || 'high',
            discussionMode: getState('discussionMode') || false,
            deepResearchMode: getState('deepResearchMode') || false,
            // Phase A (2026-05-26): 응답 스타일 (concise/default/verbose)
            style: getState('responseStyle') || 'default',
            // Phase 2 (2026-05-26): 사용자 Custom Agent (claude.ai Projects 동등). 빈값은 자동 라우팅
            userAgentId: getState('selectedUserAgentId') || undefined,
            enabledTools: getState('mcpToolsEnabled') || {},
            sessionId: getState('currentChatId'), // 세션 ID 포함
            // Phase 3.4 (2026-05-26): 메시지 편집 분기 — chat-renderer 의 enterUserMessageEdit 가 설정
            ...(window._pendingBranchFrom && window._pendingBranchFrom.sessionId
                ? { branchFromSessionId: window._pendingBranchFrom.sessionId, branchFromMessageId: window._pendingBranchFrom.messageId || undefined }
                : {}),
            // 본문 저장 여부 — settings.html saveHistoryToggle 과 연결
            // false 면 백엔드는 conversation_messages INSERT 스킵, audit log 만 기록
            saveHistory: (JSON.parse(SS.getItem(STORAGE_KEY_GENERAL_SETTINGS) || '{}').saveHistory) !== false,
            // 메모리 학습 — settings.html memoryLearningToggle 과 연결, saveHistory 와 독립
            // false 면 MemoryService 호출 스킵 (이름·선호 등 추출 비활성)
            memoryLearning: (JSON.parse(SS.getItem(STORAGE_KEY_GENERAL_SETTINGS) || '{}').memoryLearning) !== false
        };

        // 사용자 언어 설정을 WebSocket 메시지에 포함 (설정 > 브라우저 언어 순)
        const generalSettings = JSON.parse(SS.getItem(STORAGE_KEY_GENERAL_SETTINGS) || '{}');
        if (generalSettings.lang) {
            payload.language = generalSettings.lang;
        } else if (navigator.language) {
            payload.language = navigator.language.split('-')[0];
        }

        // 파일이 첨부된 경우
        if (attachedFiles.length > 0) {
            payload.files = attachedFiles.map(f => ({
                id: f.docId || f.id,
                name: f.filename || f.name,
                type: f.type
            }));

            // 이미지 파일의 base64 데이터를 images 배열로 전달
            const imageBase64List = attachedFiles
                .filter(f => f.isImage && f.base64)
                .map(f => f.base64);
            if (imageBase64List.length > 0) {
                payload.images = imageBase64List;
            }
        }

        // 문서 컨텍스트가 있는 경우 (PDF + 이미지 모두)
        const docContext = getState('activeDocumentContext');
        if (docContext) {
            payload.docId = docContext.docId;
        }

        // 인증된 사용자 정보를 WebSocket 메시지에 포함
        const storedUser = SS.getItem(STORAGE_KEY_USER);
        const parsedUser = storedUser ? JSON.parse(storedUser) : {};
        if (parsedUser.userId || parsedUser.id) payload.userId = parsedUser.userId || parsedUser.id;
        if (parsedUser.role) payload.userRole = parsedUser.role;
        if (parsedUser.tier) payload.userTier = parsedUser.tier;

        sendWsMessage(payload);
        // 전송 후 첨부 이미지 클리어 — 다음 메시지에 누적 방지 (file-attach.js)
        window.clearAttachedFiles?.();
        // Phase 3.4 (2026-05-26): 분기 정보 사용 직후 clear — 다음 메시지에 누적 방지
        if (window._pendingBranchFrom) { try { delete window._pendingBranchFrom; } catch (_e) {} }

    } catch (error) {
        console.error('[Chat] 전송 오류:', error);
        finishAssistantMessage('오류가 발생했습니다: ' + error.message);
    }

    setState('isSending', false);
}

// 하위 모듈에 콜백 주입 (순환 참조 방지)
setHideAbortButton(hideAbortButton);
setSendMessage(sendMessage);

// 전역 노출 (레거시 호환)
window.sendFeedback = sendFeedback;
window.sendMessage = sendMessage;
window.addChatMessage = addChatMessage;
window.appendToken = appendToken;
window.appendThinkingToken = appendThinkingToken;
window.finishAssistantMessage = finishAssistantMessage;
window.copyMessage = copyMessage;
window.regenerateMessage = regenerateMessage;
window.newChat = newChat;
window.useSuggestion = useSuggestion;
window.abortChat = abortChat;

export {
    sendMessage,
    restoreRunningAgentTaskCards,
    addChatMessage,
    appendToken,
    appendThinkingToken,
    finishAssistantMessage,
    copyMessage,
    regenerateMessage,
    sendFeedback,
    newChat,
    useSuggestion,
    abortChat,
    hideAbortButton
};
