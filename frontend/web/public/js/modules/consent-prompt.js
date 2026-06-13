/**
 * ============================================================
 * Consent Prompt — GDPR Phase B Fix 7 (PR-7)
 * ============================================================
 *
 * 로그인 후 첫 진입 시 사용자의 정책 동의 상태 확인 → 재동의 필요 시
 * modal 표시. CURRENT_POLICY_VERSION bump (예: 1.0 → 1.1) 또는 사용자가
 * 동의 철회 후 재로그인 한 케이스 처리.
 *
 * 동작:
 *   1. GET /api/users/me/consent/status — needsConsent 확인
 *   2. needsConsent=true → 각 pendingTypes 의 정책 본문 fetch (login.html
 *      의 showPolicyModal 동일 패턴 — marked.js 렌더링)
 *   3. 사용자가 동의 클릭 → POST /api/users/me/consent (각 type)
 *   4. 모든 type 동의 완료 → modal close
 *
 * 거부 (cancel) 옵션은 본 PR 에서 제외 — Phase B 추가 (Article 7 우선,
 * 거부 시 logout/grace period 결정은 별도 plan).
 *
 * @module modules/consent-prompt
 */

const API = '/api';

let _modalEl = null;

function ensureModal() {
    if (_modalEl) return _modalEl;
    const el = document.createElement('div');
    el.id = 'reconsentModal';
    el.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center;';
    el.innerHTML = `
        <div style="background: var(--surface, #fff); color: var(--text, #000); max-width: 720px; width: 90%; max-height: 80vh; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 8px 24px rgba(0,0,0,0.3);">
            <div style="padding: 16px 20px; border-bottom: 1px solid var(--border, #e5e5e5);">
                <h3 style="margin: 0;"><iconify-icon icon="lucide:clipboard-list"></iconify-icon> 정책 업데이트 — 재동의 필요</h3>
                <p style="margin: 6px 0 0 0; color: var(--text-muted, #888); font-size: var(--font-size-sm);">
                    아래 정책에 동의가 필요합니다. 서비스 사용을 계속하려면 동의해 주세요.
                </p>
            </div>
            <div id="reconsentBody" style="padding: 16px 20px; overflow-y: auto; flex: 1;">
                로딩 중...
            </div>
            <div id="reconsentFooter" style="padding: 12px 20px; border-top: 1px solid var(--border, #e5e5e5); text-align: right;">
                <!-- 동적 버튼 -->
            </div>
        </div>
    `;
    document.body.appendChild(el);
    _modalEl = el;
    return el;
}

function showModal() { ensureModal().style.display = 'flex'; }
function hideModal() { if (_modalEl) _modalEl.style.display = 'none'; }

async function fetchPolicy(type, locale) {
    const res = await fetch(`${API}/policies/${type}/${locale}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`policy fetch failed (${res.status})`);
    const data = await res.json();
    return data.data;  // { type, locale, version, content }
}

async function grantConsent(type, version, locale) {
    const res = await fetch(`${API}/users/me/consent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, version, locale }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data.error && data.error.message) || `grant failed (${res.status})`);
    }
}

function renderContent(md) {
    if (window.marked && typeof window.marked.parse === 'function') {
        return window.marked.parse(md);
    }
    return `<pre style="white-space: pre-wrap; font-family: inherit;">${md.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</pre>`;
}

/**
 * 메인 entry — main.js 의 initApp 끝부분에서 호출.
 * 로그인 안 한 경우 / 동의 필요 없는 경우 즉시 return (no-op).
 */
export async function checkReconsent() {
    try {
        const statusRes = await fetch(`${API}/users/me/consent/status`, { credentials: 'include' });
        if (statusRes.status === 401 || statusRes.status === 403) return;  // 로그인 안 함
        if (!statusRes.ok) return;
        const statusData = await statusRes.json();
        if (!statusData.success || !statusData.data.needsConsent) return;

        const pendingTypes = statusData.data.pendingTypes;
        const currentVersion = statusData.data.currentVersion;
        const locale = (navigator.language || 'ko').split('-')[0];

        // 각 pending type 의 정책 본문 fetch 후 sequential 동의 처리
        const policies = await Promise.all(pendingTypes.map(t => fetchPolicy(t, locale).catch(() => null)));

        ensureModal();
        const body = document.getElementById('reconsentBody');
        const footer = document.getElementById('reconsentFooter');

        let idx = 0;
        function renderNext() {
            if (idx >= pendingTypes.length) {
                hideModal();
                // 새로고침으로 상태 동기화 (settings 의 loadConsents 등)
                if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
                    return;  // chat 페이지면 그대로 진행
                }
                return;
            }
            const type = pendingTypes[idx];
            const policy = policies[idx];
            const typeLabel = type === 'privacy_policy' ? '개인정보 처리방침' : '이용약관';
            const version = (policy && policy.version) || currentVersion;
            const policyLocale = (policy && policy.locale) || locale;

            body.innerHTML = `
                <h4>${typeLabel} <span style="font-size: var(--font-size-sm); color: var(--text-muted, #888);">(v${version})</span></h4>
                <div style="margin-top: 12px; padding: 12px; background: var(--surface-secondary, #f7f7f7); border-radius: 6px; max-height: 50vh; overflow-y: auto;">
                    ${policy ? renderContent(policy.content) : '<p style="color: var(--danger, #d00);">정책 본문 로드 실패</p>'}
                </div>
            `;
            footer.innerHTML = `
                <span style="margin-right: 12px; color: var(--text-muted, #888);">${idx + 1} / ${pendingTypes.length}</span>
                <button class="btn btn-primary" id="reconsentAgreeBtn">동의하고 계속</button>
            `;
            const btn = document.getElementById('reconsentAgreeBtn');
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = '처리 중...';
                try {
                    await grantConsent(type, version, policyLocale);
                    idx++;
                    renderNext();
                } catch (e) {
                    btn.disabled = false;
                    btn.textContent = '동의하고 계속';
                    alert('동의 처리 실패: ' + (e.message || e));
                }
            });
        }
        renderNext();
        showModal();
    } catch (err) {
        // network/parse 에러 — 로깅만, 사용자 차단 안 함
        console.warn('[ConsentPrompt] check failed:', err);
    }
}
