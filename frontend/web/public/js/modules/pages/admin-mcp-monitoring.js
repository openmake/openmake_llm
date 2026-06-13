/**
 * ============================================
 * Admin — MCP Monitoring 페이지 (Phase 5.3)
 * ============================================
 * 전체 사용자의 instance 통계 + top-crashed 서버 + 24h crash trend.
 *
 * REST: /api/admin/mcp/monitoring/* (admin 전용).
 *
 * @module pages/admin-mcp-monitoring
 */
'use strict';

const escapeHTML = (str) => {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
};

window.PageModules = window.PageModules || {};

const STATE = {
    summary: null,
    topCrashed: [],
    trend: [],
};

let _listeners = [];
let _pollTimer = null;
const POLL_INTERVAL_MS = 30_000;

function addListener(target, event, handler) {
    target.addEventListener(event, handler);
    _listeners.push({ target, event, handler });
}

function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
}

async function fetchJson(path) {
    const res = await fetch(path, { credentials: 'include' });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || res.statusText;
        throw new Error(msg);
    }
    return data;
}

function formatHour(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.getHours().toString().padStart(2, '0') + ':00';
}

function renderSummary() {
    const el = document.getElementById('mcpmon-summary');
    if (!el) return;
    const s = STATE.summary;
    if (!s) { el.innerHTML = '<div class="mcp-loading">로딩 중…</div>'; return; }
    const crashRate = s.crashRate24hPct != null ? `${s.crashRate24hPct.toFixed(1)}%` : '-';
    el.innerHTML = `
        <div class="mcpmon-cards">
            <div class="mcpmon-card"><div class="mcpmon-card-label">전체 서버</div><div class="mcpmon-card-value">${escapeHTML(String(s.totalServers))}</div></div>
            <div class="mcpmon-card"><div class="mcpmon-card-label">활성 사용자</div><div class="mcpmon-card-value">${escapeHTML(String(s.totalUsers))}</div></div>
            <div class="mcpmon-card"><div class="mcpmon-card-label">현재 실행 중</div><div class="mcpmon-card-value" style="color:${s.currentRunning > 0 ? 'var(--success-bright,#22c55e)' : 'var(--text-muted)'};">${escapeHTML(String(s.currentRunning))}</div></div>
            <div class="mcpmon-card"><div class="mcpmon-card-label">누적 spawn</div><div class="mcpmon-card-value">${escapeHTML(String(s.totalSpawned))}</div></div>
            <div class="mcpmon-card"><div class="mcpmon-card-label">24h crash</div><div class="mcpmon-card-value" style="color:${s.crashed24h > 0 ? 'var(--danger-bright,#dc2626)' : 'var(--text-muted)'};">${escapeHTML(String(s.crashed24h))}</div></div>
            <div class="mcpmon-card"><div class="mcpmon-card-label">24h crash rate</div><div class="mcpmon-card-value">${escapeHTML(crashRate)}</div></div>
        </div>`;
}

function renderTopCrashed() {
    const el = document.getElementById('mcpmon-top-crashed');
    if (!el) return;
    if (STATE.topCrashed.length === 0) {
        el.innerHTML = '<div class="mcp-empty" style="color:var(--text-muted);">7일 내 crash 없음.</div>';
        return;
    }
    el.innerHTML = `
        <table class="mcpmon-table">
            <thead><tr><th>서버 ID</th><th>이름</th><th>Visibility</th><th>User</th><th>Crash (7d)</th><th>최근 crash</th></tr></thead>
            <tbody>
                ${STATE.topCrashed.map(r => `<tr>
                    <td><code>${escapeHTML(r.mcp_server_id)}</code></td>
                    <td>${escapeHTML(r.name)}</td>
                    <td>${escapeHTML(r.visibility)}</td>
                    <td><code>${escapeHTML(r.user_id || '(global)')}</code></td>
                    <td style="color:var(--danger-bright,#dc2626);font-weight:600;">${escapeHTML(String(r.crash_count))}</td>
                    <td>${escapeHTML(r.last_crash_at || '-')}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
}

function renderTrend() {
    const el = document.getElementById('mcpmon-trend');
    if (!el) return;
    if (STATE.trend.length === 0) {
        el.innerHTML = '<div class="mcp-empty" style="color:var(--text-muted);">데이터 없음.</div>';
        return;
    }
    // 타임라인 항목은 있으나 24h 동안 spawn 활동이 전혀 없으면 빈 막대(height:0) 대신 안내 표시
    const totalSpawn = STATE.trend.reduce(function (sum, t) { return sum + (t.spawned || 0); }, 0);
    if (totalSpawn === 0) {
        el.innerHTML = '<div class="mcp-empty" style="color:var(--text-muted);text-align:center;padding:var(--space-6);background:var(--bg-card);border:1px solid var(--border-light);border-radius:var(--radius-md);">최근 24시간 spawn 활동이 없습니다.</div>';
        return;
    }
    const maxSpawn = Math.max(1, ...STATE.trend.map(t => t.spawned));
    el.innerHTML = `
        <div class="mcpmon-trend-bars">
            ${STATE.trend.map(t => {
                const spawnPct = (t.spawned / maxSpawn) * 100;
                const crashPct = t.spawned > 0 ? (t.crashed / t.spawned) * 100 : 0;
                return `<div class="mcpmon-trend-bar" title="${escapeHTML(t.hour)} — spawn ${t.spawned} / crash ${t.crashed}">
                    <div class="mcpmon-trend-fill" style="height:${spawnPct.toFixed(1)}%;">
                        ${t.crashed > 0 ? `<div class="mcpmon-trend-crash" style="height:${crashPct.toFixed(1)}%;"></div>` : ''}
                    </div>
                    <div class="mcpmon-trend-label">${escapeHTML(formatHour(t.hour))}</div>
                </div>`;
            }).join('')}
        </div>
        <div style="font-size:0.85em;color:var(--text-muted);margin-top:var(--space-2);">파란색 = spawn 수 / 빨간색 = crash 비율 (각 bar 의 내부)</div>`;
}

async function loadAll() {
    try {
        const [s, t, tr] = await Promise.all([
            fetchJson('/api/admin/mcp/monitoring/summary'),
            fetchJson('/api/admin/mcp/monitoring/top-crashed?limit=10'),
            fetchJson('/api/admin/mcp/monitoring/crash-trend'),
        ]);
        STATE.summary = (s && (s.data?.summary || s.summary)) || null;
        STATE.topCrashed = (t && (t.data?.items || t.items)) || [];
        STATE.trend = (tr && (tr.data?.timeline || tr.timeline)) || [];
        renderSummary();
        renderTopCrashed();
        renderTrend();
    } catch (e) {
        toast(`로드 실패: ${e.message}`, 'error');
    }
}

function getHTML() {
    return '<div id="mcpmon-root">' +
        '<style data-spa-style="admin-mcp-monitoring">' +
        '.mcpmon-page{padding:var(--space-5);width:100%;}' +
        '.mcpmon-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--space-3);}' +
        '.mcpmon-card{background:var(--bg-card);padding:var(--space-4);border-radius:var(--radius-md);border:1px solid var(--border-light);}' +
        '.mcpmon-card-label{font-size:0.85em;color:var(--text-muted);margin-bottom:var(--space-1);}' +
        '.mcpmon-card-value{font-size:2em;font-weight:700;}' +
        '.mcpmon-section{margin-top:var(--space-6);}' +
        '.mcpmon-section h2{font-size:1.2em;margin-bottom:var(--space-3);}' +
        '.mcpmon-table{width:100%;border-collapse:collapse;}' +
        '.mcpmon-table th,.mcpmon-table td{padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-light);text-align:left;font-size:0.9em;}' +
        '.mcpmon-trend-bars{display:flex;align-items:flex-end;gap:4px;height:160px;padding:var(--space-3);background:var(--bg-card);border-radius:var(--radius-md);border:1px solid var(--border-light);}' +
        '.mcpmon-trend-bar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;}' +
        '.mcpmon-trend-fill{width:80%;background:var(--accent-indigo,#5078dc);border-radius:2px 2px 0 0;display:flex;flex-direction:column-reverse;min-height:1px;}' +
        '.mcpmon-trend-crash{width:100%;background:var(--danger-bright,#dc2626);}' +
        '.mcpmon-trend-label{font-size: var(--font-size-xs);color:var(--text-muted);margin-top:4px;}' +
        '</style>' +
        '<div class="mcpmon-page">' +
        '<header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">' +
            '<div><h1>MCP 모니터링</h1><p style="color:var(--text-muted);margin:0;">전체 사용자의 MCP server lifecycle 통계 (30초 자동 갱신).</p></div>' +
            '<button class="btn btn-primary" id="mcpmon-refresh" type="button"><iconify-icon icon=lucide:refresh-cw></iconify-icon> 새로고침</button>' +
        '</header>' +
        '<div id="mcpmon-summary"><div class="mcp-loading">로딩 중…</div></div>' +
        '<section class="mcpmon-section">' +
            '<h2><iconify-icon icon=lucide:trending-down></iconify-icon> 24h spawn / crash trend</h2>' +
            '<div id="mcpmon-trend"><div class="mcp-loading">로딩 중…</div></div>' +
        '</section>' +
        '<section class="mcpmon-section">' +
            '<h2><iconify-icon icon=lucide:flame></iconify-icon> Top crashed servers (7일)</h2>' +
            '<div id="mcpmon-top-crashed"><div class="mcp-loading">로딩 중…</div></div>' +
        '</section>' +
        '</div></div>';
}

function init() {
    const btn = document.getElementById('mcpmon-refresh');
    if (btn) addListener(btn, 'click', loadAll);
    loadAll();
    _pollTimer = setInterval(loadAll, POLL_INTERVAL_MS);
}

function cleanup() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    for (const { target, event, handler } of _listeners) {
        try { target.removeEventListener(event, handler); } catch { /* noop */ }
    }
    _listeners = [];
    STATE.summary = null;
    STATE.topCrashed = [];
    STATE.trend = [];
}

window.PageModules['admin-mcp-monitoring'] = { getHTML, init, cleanup };

const pageModule = window.PageModules['admin-mcp-monitoring'];
export default pageModule;
