/**
 * ============================================
 * External LLM Keys Page - 외부 LLM provider BYO Key 관리
 * ============================================
 * Anthropic / OpenAI 호환 endpoint(OpenRouter, Gemini, Groq, Together,
 * Mistral, Cohere, Ollama-remote 등)의 API 키를 등록·갱신·삭제·검증하고
 * 최근 사용량(토큰 수, 비용)을 표시합니다.
 *
 * standalone /external-keys.html 과 동일 기능 — SPA 라우터 진입 시 사용.
 *
 * @module pages/external-keys
 */
'use strict';
window.PageModules = window.PageModules || {};
let _intervals = [];
let _timeouts = [];

function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

var CSS =
    '.ek-container { max-width: 800px; margin: 0 auto; padding: var(--space-6); }' +
    '.ek-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); margin-bottom:var(--space-4); }' +
    '.ek-card h3 { margin:0 0 var(--space-2) 0; color:var(--text-primary); font-size:var(--font-size-lg); display:flex; align-items:center; gap:var(--space-2); flex-wrap:wrap; }' +
    '.ek-help { color:var(--text-muted); font-size:var(--font-size-sm); line-height:1.6; margin-bottom:var(--space-3); }' +
    '.ek-form { display:flex; flex-direction:column; gap:var(--space-3); }' +
    '.ek-form label { font-size:var(--font-size-sm); color:var(--text-secondary); font-weight:var(--font-weight-medium); }' +
    '.ek-form input { width:100%; background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:var(--space-3); color:var(--text-primary); font-family:inherit; box-sizing:border-box; }' +
    '.ek-form input:focus { outline:none; border-color:var(--accent-primary); }' +
    '.ek-actions { display:flex; gap:var(--space-2); justify-content:flex-end; margin-top:var(--space-2); flex-wrap:wrap; }' +
    '.ek-btn { padding:var(--space-2) var(--space-4); border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); border:none; }' +
    '.ek-btn-primary { background:var(--accent-primary); color:#fff; }' +
    '.ek-btn-danger { background:var(--danger); color:#fff; }' +
    '.ek-btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light); }' +
    '.ek-status { display:flex; gap:var(--space-3); margin-top:var(--space-3); font-size:var(--font-size-sm); flex-wrap:wrap; }' +
    '.ek-status-row { color:var(--text-muted); }' +
    '.ek-status-row code { background:var(--bg-tertiary); padding:2px 6px; border-radius:var(--radius-sm); font-family:monospace; }' +
    '.ek-disabled-badge { background:var(--bg-tertiary); color:var(--text-muted); padding:2px 8px; border-radius:var(--radius-md); font-size:11px; margin-left:var(--space-2); }' +
    '.ek-active-badge { background:var(--success); color:#fff; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; margin-left:var(--space-2); }' +
    '.ek-validation-ok { color:var(--success); }' +
    '.ek-validation-fail { color:var(--danger); }';

var HTML =
    '<div class="ek-container">' +
        '<p style="color:var(--text-muted); margin-bottom:var(--space-5);">' +
            'Anthropic / OpenAI 호환 endpoint 등 외부 LLM provider 의 API 키를 등록합니다. ' +
            '키는 AES-256-GCM 으로 암호화되어 저장되며, 사용량은 본 서비스가 아닌 해당 provider 계정으로 청구됩니다.' +
        '</p>' +
        '<div id="providerList"><div style="color:var(--text-muted)">불러오는 중...</div></div>' +
        '<div class="ek-card" style="margin-top:var(--space-6)">' +
            '<h3>📊 최근 외부 사용량</h3>' +
            '<div id="usageList" class="ek-help">불러오는 중...</div>' +
        '</div>' +
    '</div>';

window.PageModules['external-keys'] = {
    getHTML: function () {
        return '<style data-spa-style="external-keys">' + CSS + '</style>' + HTML;
    },
    init: function () {
        load();
        loadUsage();
    },
    cleanup: function () {
        _intervals.forEach(function (id) { clearInterval(id); });
        _intervals = [];
        _timeouts.forEach(function (id) { clearTimeout(id); });
        _timeouts = [];
    },
};

// --- 헬퍼 ---

function showToast(msg, type) {
    if (window.showToast && typeof window.showToast === 'function' && window.showToast.length >= 1) {
        try {
            window.showToast(msg, type);
            return;
        } catch (_) { /* fallthrough */ }
    }
    // 라이트한 fallback (toast element 없을 때)
    console[type === 'error' ? 'error' : 'log'](msg);
}

function fmt(d) {
    if (!d) return '-';
    try { return new Date(d).toLocaleString('ko-KR'); } catch (e) { return '-'; }
}

function authFetch(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return (window.authFetch || fetch)(url, opts);
}

// --- Provider 카탈로그 + 사용자 키 ---

async function load() {
    var root = document.getElementById('providerList');
    if (!root) return;
    try {
        var res = await authFetch('/api/external-keys');
        if (!res.ok) {
            if (res.status === 401) {
                root.innerHTML =
                    '<div style="text-align:center; padding:var(--space-8); color:var(--text-muted)">' +
                    '로그인이 필요합니다. <a href="/login.html">로그인</a></div>';
                return;
            }
            throw new Error('로드 실패');
        }
        var json = await res.json();
        render(json.data && json.data.providers ? json.data.providers : []);
    } catch (e) {
        showToast('카탈로그 로드 실패', 'error');
    }
}

function render(providers) {
    var root = document.getElementById('providerList');
    if (!root) return;
    if (!providers.length) {
        root.innerHTML =
            '<div style="text-align:center; padding:var(--space-8); color:var(--text-muted)">' +
            '등록 가능한 provider 가 없습니다.</div>';
        return;
    }
    root.innerHTML = providers.map(function (p) {
        var enabled = p.enabled;
        var k = p.user_key;
        var validation = k && k.last_validated_at
            ? (k.last_validation_ok
                ? '<span class="ek-validation-ok">✓ ' + fmt(k.last_validated_at) + ' 검증 통과</span>'
                : '<span class="ek-validation-fail">✗ ' + esc(k.last_validation_error || '검증 실패') + '</span>')
            : '<span style="color:var(--text-muted)">미검증</span>';

        return ''
            + '<div class="ek-card">'
            + '<h3>' + esc(p.display_name)
            + (enabled ? '<span class="ek-active-badge">활성</span>' : '<span class="ek-disabled-badge">Coming Soon</span>')
            + (k ? '<span class="ek-active-badge">' + esc(k.key_prefix) + '</span>' : '')
            + '</h3>'
            + '<div class="ek-help">' + esc(p.help_text) + '</div>'
            + (enabled ? renderForm(p, k) : '')
            + (k ? '<div class="ek-status">'
                + '<span class="ek-status-row">검증: ' + validation + '</span>'
                + '<span class="ek-status-row">마지막 사용: ' + fmt(k.last_used_at) + '</span>'
                + '<span class="ek-status-row">등록: ' + fmt(k.created_at) + '</span>'
                + '</div>' : '')
            + '</div>';
    }).join('');

    // 폼 핸들러 바인딩
    document.querySelectorAll('[data-ek-action]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            var action = btn.dataset.ekAction;
            var provider = btn.dataset.provider;
            if (action === 'save') saveKey(provider);
            else if (action === 'delete') deleteKey(provider);
            else if (action === 'validate') validateKey(provider);
        });
    });
}

function renderForm(p, k) {
    var id = 'ek-' + p.provider_id;
    return ''
        + '<div class="ek-form">'
        + '<label>표시 이름 <input type="text" id="' + id + '-name" value="' + esc(k ? k.display_name : p.display_name) + '" /></label>'
        + (p.sdk_type === 'openai-compatible'
            ? '<label>Base URL <input type="text" id="' + id + '-baseurl" value="' + esc(k && k.base_url ? k.base_url : p.default_base_url) + '" /></label>'
            : '')
        + '<label>API Key <input type="password" id="' + id + '-key" placeholder="' + (k ? '변경하지 않으려면 비워두세요' : (p.key_prefix_pattern || 'API 키')) + '" /></label>'
        + '<div class="ek-actions">'
        + (k ? '<button class="ek-btn ek-btn-secondary" data-ek-action="validate" data-provider="' + esc(p.provider_id) + '">🔍 검증</button>' : '')
        + (k ? '<button class="ek-btn ek-btn-danger" data-ek-action="delete" data-provider="' + esc(p.provider_id) + '">🗑️ 삭제</button>' : '')
        + '<button class="ek-btn ek-btn-primary" data-ek-action="save" data-provider="' + esc(p.provider_id) + '">' + (k ? '갱신' : '등록') + '</button>'
        + '</div>'
        + '</div>';
}

async function saveKey(providerId) {
    var id = 'ek-' + providerId;
    var nameEl = document.getElementById(id + '-name');
    var keyEl = document.getElementById(id + '-key');
    var baseUrlEl = document.getElementById(id + '-baseurl');
    var apiKey = keyEl.value.trim();
    if (!apiKey) {
        showToast('API 키를 입력하세요', 'error');
        return;
    }
    var sdkType = baseUrlEl ? 'openai-compatible' : 'anthropic';
    try {
        var res = await authFetch('/api/external-keys/' + encodeURIComponent(providerId), {
            method: 'POST',
            body: JSON.stringify({
                sdk_type: sdkType,
                display_name: nameEl.value.trim() || providerId,
                base_url: baseUrlEl ? (baseUrlEl.value.trim() || null) : null,
                api_key: apiKey,
            }),
        });
        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.error || err.message || '저장 실패');
        }
        showToast('저장되었습니다');
        load();
    } catch (e) {
        showToast(e.message || '저장 실패', 'error');
    }
}

async function deleteKey(providerId) {
    if (!confirm("'" + providerId + "' 키를 삭제하시겠습니까?")) return;
    try {
        var res = await authFetch('/api/external-keys/' + encodeURIComponent(providerId), { method: 'DELETE' });
        if (!res.ok) throw new Error('삭제 실패');
        showToast('삭제되었습니다');
        load();
    } catch (e) {
        showToast('삭제 실패', 'error');
    }
}

async function validateKey(providerId) {
    showToast('검증 중...');
    try {
        var res = await authFetch('/api/external-keys/' + encodeURIComponent(providerId) + '/validate', { method: 'POST' });
        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            showToast(err.error || err.message || '검증 실패', 'error');
            return;
        }
        showToast('검증 성공');
        load();
    } catch (e) {
        showToast('검증 실패', 'error');
    }
}

// --- 사용량 ---

async function loadUsage() {
    var root = document.getElementById('usageList');
    if (!root) return;
    try {
        var res = await authFetch('/api/external-keys/usage/recent?limit=20');
        if (!res.ok) {
            if (res.status !== 401) root.textContent = '사용량 로드 실패';
            return;
        }
        var json = await res.json();
        var rows = (json.data && json.data.usage) || [];
        if (!rows.length) {
            root.innerHTML =
                '<div style="color:var(--text-muted)">아직 외부 provider 호출 기록이 없습니다.</div>';
            return;
        }
        var totalIn = rows.reduce(function (s, r) { return s + (r.input_tokens || 0); }, 0);
        var totalOut = rows.reduce(function (s, r) { return s + (r.output_tokens || 0); }, 0);
        var totalCostMicros = rows.reduce(function (s, r) { return s + (r.cost_usd_micros || 0); }, 0);
        var fmtUsd = function (micros) {
            if (!micros) return '-';
            var usd = micros / 1000000;
            if (usd >= 0.01) return '$' + usd.toFixed(4);
            if (usd >= 0.0001) return '$' + usd.toFixed(6);
            return '<$0.0001';
        };
        root.innerHTML = ''
            + '<div style="margin-bottom:var(--space-3); color:var(--text-secondary)">'
            + '최근 ' + rows.length + '건 — 입력 토큰 누계 <b>' + totalIn.toLocaleString() + '</b>, '
            + '출력 토큰 누계 <b>' + totalOut.toLocaleString() + '</b>, '
            + '비용 누계 <b>' + fmtUsd(totalCostMicros) + '</b> '
            + '<span style="color:var(--text-muted); font-size:0.85em">(추정 — 정확한 청구는 각 provider 콘솔 참조)</span>'
            + '</div>'
            + '<table style="width:100%; border-collapse:collapse; font-size:var(--font-size-sm)">'
            + '<thead><tr style="text-align:left; color:var(--text-muted); border-bottom:1px solid var(--border-light)">'
            + '<th style="padding:var(--space-2) 0">시각</th><th>Provider</th><th>모델</th>'
            + '<th style="text-align:right">in</th><th style="text-align:right">out</th>'
            + '<th style="text-align:right">비용</th><th style="text-align:right">지연</th>'
            + '</tr></thead>'
            + '<tbody>'
            + rows.map(function (r) {
                return '<tr style="border-bottom:1px solid var(--border-light)">'
                    + '<td style="padding:var(--space-2) 0; color:var(--text-muted)">' + esc(fmt(r.occurred_at)) + '</td>'
                    + '<td>' + esc(r.provider_id) + '</td>'
                    + '<td><code style="background:var(--bg-tertiary); padding:1px 4px; border-radius:var(--radius-sm)">' + esc(r.model_id) + '</code></td>'
                    + '<td style="text-align:right">' + (r.input_tokens || 0).toLocaleString() + '</td>'
                    + '<td style="text-align:right">' + (r.output_tokens || 0).toLocaleString() + '</td>'
                    + '<td style="text-align:right; color:var(--text-secondary)">' + fmtUsd(r.cost_usd_micros) + '</td>'
                    + '<td style="text-align:right; color:var(--text-muted)">' + (r.duration_ms ? r.duration_ms + 'ms' : '-') + '</td>'
                    + '</tr>';
            }).join('')
            + '</tbody></table>';
    } catch (e) {
        root.textContent = '사용량 로드 실패';
    }
}

const { getHTML, init, cleanup } = window.PageModules['external-keys'];
export default { getHTML, init, cleanup };
