/**
 * ============================================
 * Model Selector Component
 * ============================================
 * 채팅 입력 영역 좌측 통합 모델 셀렉트 dropdown.
 * Provider 카탈로그 + 등록된 외부 모델 + "+ 새 LLM 키 등록" 진입점.
 *
 * 의존: window.AddKeyModal, window.UsageModal, window.ModelActionMenu
 * (각각 add-key-modal.js / usage-modal.js / model-action-menu.js 가 글로벌 노출)
 *
 * @module components/model-selector
 */
'use strict';

const STORAGE_KEY = 'selectedModel';

// ============================================
// Debug overlay — 임시 진단용 (운영 안정 후 제거)
// 사용자가 콘솔 못 보는 환경에서 화면 우상단에 모든 ModelSelector 이벤트 표시.
// localStorage.setItem('MS_DEBUG_OFF', '1') 하면 비활성.
// ============================================
function logDebug(msg) {
    try { console.info('[ModelSelector]', msg); } catch (_) {}
    if (localStorage.getItem('MS_DEBUG_OFF') === '1') return;
    let panel = document.getElementById('ms-debug-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'ms-debug-panel';
        panel.style.cssText =
            'position:fixed;top:8px;right:8px;background:rgba(0,0,0,0.85);color:#0f0;' +
            'padding:8px 12px;font-size:11px;font-family:monospace;border-radius:6px;' +
            'z-index:99999;max-width:420px;max-height:60vh;overflow-y:auto;line-height:1.4;' +
            'box-shadow:0 4px 12px rgba(0,0,0,0.5)';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕ close';
        closeBtn.style.cssText = 'position:absolute;top:4px;right:4px;background:#333;color:#fff;border:none;cursor:pointer;font-size:10px;padding:2px 6px;border-radius:3px';
        closeBtn.onclick = function () {
            panel.remove();
            try { localStorage.setItem('MS_DEBUG_OFF', '1'); } catch (_) {}
        };
        const title = document.createElement('div');
        title.textContent = '🔍 ModelSelector 진단 (close=비활성)';
        title.style.cssText = 'color:#ff0;margin-bottom:4px;font-weight:bold';
        panel.appendChild(closeBtn);
        panel.appendChild(title);
        document.body.appendChild(panel);
    }
    const line = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
    line.textContent = '[' + ts + '] ' + msg;
    panel.appendChild(line);
    while (panel.children.length > 25) panel.removeChild(panel.children[2]);
    panel.scrollTop = panel.scrollHeight;
}

const PROVIDER_LABELS = {
    ollama: '🖥️ Ollama 로컬',
    anthropic: '🧠 Anthropic Claude',
    openrouter: '🌐 OpenRouter',
    gemini: '✨ Google Gemini',
    groq: '⚡ Groq',
    together: '🤝 Together AI',
    mistral: '🌬️ Mistral AI',
    cohere: '🎯 Cohere',
    'ollama-remote': '🖥️ Ollama (원격)',
    'openai-compatible': '🌐 OpenAI 호환',
};

const PROVIDER_ORDER = [
    'ollama', 'anthropic', 'openrouter', 'gemini', 'groq',
    'together', 'mistral', 'cohere', 'ollama-remote', 'openai-compatible',
];

let _container = null;
let _isOpen = false;
let _models = [];
let _providers = [];
let _isAuthenticated = false;
let _isAdmin = false;

function escAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

async function authFetch(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    return (window.authFetch || fetch)(url, opts);
}

async function loadData() {
    try {
        const [modelsRes, providersRes] = await Promise.all([
            authFetch('/api/models'),
            authFetch('/api/external-keys'),
        ]);
        if (modelsRes.ok) {
            const json = await modelsRes.json();
            const data = json.data || json;
            _models = data.models || [];
        }
        if (providersRes.ok) {
            _isAuthenticated = true;
            const json = await providersRes.json();
            _providers = (json.data && json.data.providers) || [];
        } else {
            _isAuthenticated = false;
            _providers = [];
        }
    } catch (e) {
        console.warn('[ModelSelector] 데이터 로드 실패:', e);
    }

    _isAdmin = !!(window.AppState && window.AppState.user && window.AppState.user.role === 'admin')
        || (typeof window.isAdmin === 'function' && window.isAdmin());
}

function getSelectedModel() {
    return localStorage.getItem(STORAGE_KEY)
        || (_models[0] && _models[0].modelId)
        || '';
}

function setSelectedModel(modelId) {
    try {
        localStorage.setItem(STORAGE_KEY, modelId);
    } catch (e) {
        console.warn('[ModelSelector] localStorage 쓰기 실패 (incognito?):', e);
    }
    renderTrigger();
    if (window.showToast) window.showToast('🤖 모델 변경됨: ' + modelId);
    if (typeof window.applyModelCapabilityToggles === 'function') {
        try {
            window.applyModelCapabilityToggles(modelId);
        } catch (e) {
            console.warn('[ModelSelector] applyModelCapabilityToggles 오류:', e);
        }
    }
    // chat.js 등이 settings select#modelSelect 를 읽는 경우 호환성 — 동일 값 동기화
    const legacySel = document.getElementById('modelSelect');
    if (legacySel) legacySel.value = modelId;
}

function renderTrigger() {
    if (!_container) return;
    const selected = getSelectedModel();
    const model = _models.find(m => m.modelId === selected);
    const displayName = model ? model.name : (selected || '모델 선택');
    const trigger = _container.querySelector('.model-selector-trigger');
    if (trigger) {
        trigger.innerHTML =
            '<span class="icon">📋</span>' +
            '<span class="name">' + escText(displayName) + '</span>' +
            '<span class="arrow">▾</span>';
    }
}

function groupModelsByProvider() {
    const groups = {};
    for (const m of _models) {
        const provider = m.provider || 'ollama';
        if (!groups[provider]) groups[provider] = [];
        groups[provider].push(m);
    }
    if (!_isAdmin && groups.ollama && groups.ollama.length > 1) {
        const selected = getSelectedModel();
        const active = groups.ollama.find(m => m.modelId === selected) || groups.ollama[0];
        groups.ollama = [active];
    }
    return groups;
}

function renderDropdown() {
    const dropdown = _container.querySelector('.model-selector-dropdown');
    if (!dropdown) return;

    const groups = groupModelsByProvider();
    const selected = getSelectedModel();
    let html = '';

    for (const pid of PROVIDER_ORDER) {
        if (!groups[pid] || groups[pid].length === 0) continue;
        const label = PROVIDER_LABELS[pid] || pid;
        const count = groups[pid].length;
        // OpenWork pattern (provider-auth-modal.tsx:42 modelCount) — 카탈로그 entry 옆에 모델 수 표시
        html += '<div class="model-selector-optgroup-label">' +
            escText(label) +
            ' <span style="opacity:0.6;font-weight:normal">(' + count + ')</span>' +
            '</div>';
        for (const m of groups[pid]) {
            const isActive = m.modelId === selected;
            const isOllama = pid === 'ollama';
            const disabled = isOllama && !_isAdmin && !isActive;
            html +=
                '<div class="model-selector-option' +
                (isActive ? ' active' : '') +
                (disabled ? ' disabled' : '') +
                '" data-model-id="' + escAttr(m.modelId) + '" data-provider="' + escAttr(pid) + '">' +
                '<span>' + (isActive ? '<span class="check">✓ </span>' : '') + escText(m.name) + '</span>' +
                (pid !== 'ollama' && _isAuthenticated
                    ? '<button type="button" class="menu-trigger" data-action="open-menu" data-provider="' +
                      escAttr(pid) + '" data-model-id="' + escAttr(m.modelId) + '" title="메뉴">⋮</button>'
                    : '') +
                '</div>';
        }
    }

    if (_isAuthenticated && _providers.length > 0) {
        const registered = new Set(_providers.filter(p => p.user_key).map(p => p.provider_id));
        const unregistered = _providers.filter(p => p.enabled && !registered.has(p.provider_id));
        if (unregistered.length > 0) {
            html += '<div class="model-selector-separator"></div>';
            html += '<div class="model-selector-optgroup-label">➕ 새 LLM 키 등록</div>';
            for (const p of unregistered) {
                html +=
                    '<div class="model-selector-add-option" data-action="add-key" data-provider="' +
                    escAttr(p.provider_id) + '">' +
                    '+ ' + escText(p.display_name) +
                    '</div>';
            }
        }
    }

    if (!html) {
        html = '<div style="padding:12px;color:var(--text-muted);text-align:center">사용 가능한 모델 없음</div>';
    }

    dropdown.innerHTML = html;
    bindDropdownHandlers(dropdown);
}

/**
 * 렌더된 dropdown 의 각 인터랙티브 element 에 직접 핸들러 부착.
 * 이벤트 위임이 실패하는 환경(레이어 z-index, 부모 핸들러 중복 등) 회피.
 */
function bindDropdownHandlers(dropdown) {
    const optionCount = dropdown.querySelectorAll('.model-selector-option').length;
    const addCount = dropdown.querySelectorAll('[data-action="add-key"]').length;
    const menuCount = dropdown.querySelectorAll('[data-action="open-menu"]').length;
    logDebug('dropdown 렌더 — opt=' + optionCount + ', +추가=' + addCount + ', ⋮=' + menuCount);

    // 모델 옵션 클릭 — 모델 변경
    dropdown.querySelectorAll('.model-selector-option').forEach((el) => {
        if (el.classList.contains('disabled')) return;
        el.addEventListener('click', function (ev) {
            // ⋮ 메뉴 trigger 클릭은 별도 처리 — option 클릭과 분리
            if (ev.target.closest('[data-action="open-menu"]')) return;
            ev.preventDefault();
            ev.stopPropagation();
            const modelId = el.dataset.modelId;
            logDebug('✓ 옵션 클릭: ' + modelId);
            if (modelId) {
                setSelectedModel(modelId);
                closeDropdown();
            } else {
                logDebug('  ✗ modelId 비어있음 — dataset 누락');
            }
        });
    });

    // ⋮ 메뉴 trigger 클릭
    dropdown.querySelectorAll('[data-action="open-menu"]').forEach((el) => {
        el.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const providerId = el.dataset.provider;
            const modelId = el.dataset.modelId;
            logDebug('⋮ 메뉴 클릭: ' + providerId);
            if (window.ModelActionMenu) {
                window.ModelActionMenu.open(el, { providerId, modelId });
            } else {
                logDebug('  ✗ window.ModelActionMenu 미정의');
            }
        });
    });

    // "+ 새 LLM 키 등록" 클릭
    dropdown.querySelectorAll('[data-action="add-key"]').forEach((el) => {
        el.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            const providerId = el.dataset.provider;
            logDebug('+ 추가 클릭: ' + providerId);
            if (window.AddKeyModal) {
                window.AddKeyModal.open({ providerId, onSuccess: refresh });
            } else {
                logDebug('  ✗ window.AddKeyModal 미정의');
                if (window.showToast) window.showToast('등록 모달 로드 실패 — 페이지 새로고침 필요', 'error');
            }
            closeDropdown();
        });
    });
}

function toggleDropdown() {
    _isOpen = !_isOpen;
    logDebug('toggle → ' + (_isOpen ? '열림' : '닫힘'));
    const dropdown = _container.querySelector('.model-selector-dropdown');
    if (dropdown) dropdown.classList.toggle('open', _isOpen);
    if (_isOpen) renderDropdown();
}

function closeDropdown() {
    _isOpen = false;
    const dropdown = _container.querySelector('.model-selector-dropdown');
    if (dropdown) dropdown.classList.remove('open');
}

export async function mount(targetElement) {
    logDebug('mount 시작');
    _container = document.createElement('div');
    _container.className = 'model-selector';
    _container.innerHTML =
        '<button type="button" class="model-selector-trigger" data-action="toggle">' +
        '<span class="icon">📋</span><span class="name">로딩 중...</span><span class="arrow">▾</span>' +
        '</button>' +
        '<div class="model-selector-dropdown"></div>';
    targetElement.appendChild(_container);

    _container.addEventListener('click', function (ev) {
        try {
            const toggleBtn = ev.target.closest('[data-action="toggle"]');
            if (toggleBtn) {
                ev.preventDefault();
                ev.stopPropagation();
                toggleDropdown();
                return;
            }
            const menuTrigger = ev.target.closest('[data-action="open-menu"]');
            if (menuTrigger) {
                ev.preventDefault();
                ev.stopPropagation();
                const providerId = menuTrigger.dataset.provider;
                const modelId = menuTrigger.dataset.modelId;
                if (window.ModelActionMenu) {
                    window.ModelActionMenu.open(menuTrigger, { providerId, modelId });
                } else {
                    console.warn('[ModelSelector] window.ModelActionMenu 미정의 — 모듈 로드 실패');
                }
                return;
            }
            const addOption = ev.target.closest('[data-action="add-key"]');
            if (addOption) {
                ev.preventDefault();
                ev.stopPropagation();
                const providerId = addOption.dataset.provider;
                if (window.AddKeyModal) {
                    window.AddKeyModal.open({ providerId, onSuccess: refresh });
                } else {
                    console.warn('[ModelSelector] window.AddKeyModal 미정의 — 모듈 로드 실패');
                    if (window.showToast) window.showToast('등록 모달 로드 실패 — 페이지 새로고침 필요', 'error');
                }
                closeDropdown();
                return;
            }
            const option = ev.target.closest('.model-selector-option');
            if (option && !option.classList.contains('disabled')) {
                ev.preventDefault();
                ev.stopPropagation();
                const modelId = option.dataset.modelId;
                if (modelId) {
                    setSelectedModel(modelId);
                    closeDropdown();
                }
            }
        } catch (err) {
            console.error('[ModelSelector] 클릭 핸들러 오류:', err);
        }
    });

    document.addEventListener('click', function (ev) {
        if (_isOpen && _container && !_container.contains(ev.target)) closeDropdown();
    });

    await loadData();
    renderTrigger();
    logDebug('mount 완료 — models=' + _models.length + ' / providers=' + _providers.length +
        ' / auth=' + _isAuthenticated + ' / admin=' + _isAdmin +
        ' / globals: AddKey=' + !!window.AddKeyModal +
        ', Usage=' + !!window.UsageModal +
        ', Menu=' + !!window.ModelActionMenu);

    if (location.search.includes('openModelSelector=1')) {
        toggleDropdown();
    }
}

export function refresh() {
    logDebug('refresh 호출');
    return loadData().then(() => {
        const grouped = groupModelsByProvider();
        const summary = Object.keys(grouped).map(p => p + '=' + grouped[p].length).join(', ');
        logDebug('refresh 완료 — models=' + _models.length + ' (' + summary + ')');
        renderTrigger();
        if (_isOpen) renderDropdown();
    });
}

export default { mount, refresh };
