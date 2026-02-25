/**
 * ============================================
 * External Page - 외부 MCP 서버 관리
 * ============================================
 * 외부 MCP(Model Context Protocol) 서버의 연결, 관리,
 * 도구 목록 조회, 서버 등록/제거를 처리하는
 * SPA 페이지 모듈입니다.
 *
 * @module pages/external
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['external'] = {
        getHTML: function() {
            return '<div class="page-external">' +
                '<style data-spa-style="external">' +
                ".service-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n        .service-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-6); text-align:center; transition:border-color .2s; position:relative; }\n        .service-card:hover { border-color:var(--accent-primary); }\n        .service-icon { font-size:3rem; margin-bottom:var(--space-3); }\n        .service-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); }\n        .service-card .account { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-4); }\n        .status-badge { position:absolute; top:var(--space-3); right:var(--space-3); padding:2px 10px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .status-on { background:var(--success); color:#fff; }\n        .status-off { background:var(--bg-tertiary); color:var(--text-muted); }\n        .service-actions { display:flex; gap:var(--space-2); justify-content:center; flex-wrap:wrap; }\n        .service-actions button { padding:var(--space-2) var(--space-3); border:none; border-radius:var(--radius-md); cursor:pointer; font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .btn-connect { background:var(--accent-primary); color:#fff; }\n        .btn-disconnect { background:var(--danger); color:#fff; }\n        .btn-files { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:550px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n        .form-group { margin-bottom:var(--space-4); }\n        .form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .form-group input { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; box-sizing:border-box; }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-primary { background:var(--accent-primary); color:#fff; }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n\n        .file-list { max-height:400px; overflow-y:auto; }\n        .file-item { display:flex; justify-content:space-between; align-items:center; padding:var(--space-3); border-bottom:1px solid var(--border-light); }\n        .file-item:last-child { border-bottom:none; }\n        .file-name { color:var(--text-primary); font-size:var(--font-size-sm); }\n        .file-meta { color:var(--text-muted); font-size:12px; }\n        .empty-state { text-align:center; padding:var(--space-6); color:var(--text-muted); }\n\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                "\n.coming-soon-notice { background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-4) var(--space-5); margin-bottom:var(--space-5); display:flex; align-items:center; gap:var(--space-3); color:var(--text-secondary); font-size:var(--font-size-sm); line-height:1.6; }\n.coming-soon-notice .notice-icon { font-size:1.5rem; flex-shrink:0; }\n.service-card.coming-soon { opacity:0.6; pointer-events:none; }\n.status-coming-soon { background:var(--bg-tertiary); color:var(--text-muted); border:1px solid var(--border-light); }\n.btn-coming-soon { background:var(--bg-tertiary); color:var(--text-muted); cursor:not-allowed; border:1px solid var(--border-light) !important; }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>외부 서비스 연동</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"coming-soon-notice\"><span class=\"notice-icon\">🚧</span><div><strong>개발 예정 기능</strong><br>외부 서비스 연동(OAuth 인증, 파일 동기화)은 현재 준비 중입니다. 향후 업데이트에서 지원될 예정입니다.</div></div>\n                <div id=\"serviceGrid\" class=\"service-grid\"><div class=\"loading\">불러오는 중...</div></div>\n            </div>\n<div class=\"modal-overlay\" id=\"connectModal\">\n        <div class=\"modal\">\n            <h2 id=\"connectTitle\">서비스 연결</h2>\n            <div class=\"form-group\"><label for=\"accessToken\">액세스 토큰 <span style=\"color:var(--danger)\">*</span></label><input type=\"text\" id=\"accessToken\" placeholder=\"액세스 토큰을 입력하세요\"></div>\n            <div class=\"form-group\"><label for=\"refreshToken\">리프레시 토큰</label><input type=\"text\" id=\"refreshToken\" placeholder=\"(선택사항)\"></div>\n            <div class=\"form-group\"><label for=\"accountEmail\">계정 이메일</label><input type=\"text\" id=\"accountEmail\" placeholder=\"(선택사항)\"></div>\n            <div class=\"form-group\"><label for=\"accountName\">계정 이름</label><input type=\"text\" id=\"accountName\" placeholder=\"(선택사항)\"></div>\n            <div class=\"modal-actions\">\n                <button class=\"btn-secondary\" onclick=\"closeConnect()\">취소</button>\n                <button class=\"btn-primary\" onclick=\"submitConnect()\">연결</button>\n            </div>\n        </div>\n    </div>\n<div class=\"modal-overlay\" id=\"filesModal\">\n        <div class=\"modal\">\n            <h2 id=\"filesTitle\">캐시된 파일</h2>\n            <div id=\"fileList\" class=\"file-list\"><div class=\"loading\">불러오는 중...</div></div>\n            <div class=\"modal-actions\"><button class=\"btn-secondary\" onclick=\"closeFiles()\">닫기</button></div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                const SERVICES = [
            { type:'google_drive', label:'Google Drive', icon:'📁' },
            { type:'notion', label:'Notion', icon:'📓' },
            { type:'github', label:'GitHub', icon:'🐙' },
            { type:'slack', label:'Slack', icon:'💬' },
            { type:'dropbox', label:'Dropbox', icon:'📦' }
        ];
        let connections = [];
        let connectingType = null;

        function authFetch(url, options = {}) {
            return window.authFetch(url, options).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        function getConnection(serviceType) {
            return connections.find(c => c.serviceType === serviceType || c.service_type === serviceType);
        }

        async function loadConnections() {
            try {
                const res = await authFetch(API_ENDPOINTS.EXTERNAL);
                connections = res.data || res || [];
                renderServices();
            } catch (e) { showToast('연결 정보 로드 실패', 'error'); }
        }

        function renderServices() {
            document.getElementById('serviceGrid').innerHTML = SERVICES.map(s => {
                return `
                <div class="service-card coming-soon">
                    <span class="status-badge status-coming-soon">준비 중</span>
                    <div class="service-icon">${s.icon}</div>
                    <h3>${s.label}</h3>
                    <div class="account">향후 지원 예정</div>
                    <div class="service-actions">
                        <button class="btn-coming-soon" disabled>준비 중</button>
                    </div>
                </div>`;
            }).join('');
        }

        function openConnect(type, label) {
            connectingType = type;
            document.getElementById('connectTitle').textContent = label + ' 연결';
            document.getElementById('accessToken').value = '';
            document.getElementById('refreshToken').value = '';
            document.getElementById('accountEmail').value = '';
            document.getElementById('accountName').value = '';
            document.getElementById('connectModal').classList.add('open');
        }

        function closeConnect() { document.getElementById('connectModal').classList.remove('open'); }

        async function submitConnect() {
            const accessToken = document.getElementById('accessToken').value.trim();
            if (!accessToken) { showToast('액세스 토큰을 입력하세요', 'error'); return; }
            const body = {
                serviceType: connectingType,
                accessToken,
                refreshToken: document.getElementById('refreshToken').value.trim() || undefined,
                accountEmail: document.getElementById('accountEmail').value.trim() || undefined,
                accountName: document.getElementById('accountName').value.trim() || undefined
            };
            try {
                await authFetch(API_ENDPOINTS.EXTERNAL, { method:'POST', body:JSON.stringify(body) });
                showToast('서비스가 연결되었습니다');
                closeConnect(); loadConnections();
            } catch (e) { showToast('연결 실패', 'error'); }
        }

        async function disconnect(serviceType) {
            if (!confirm('이 서비스 연결을 해제하시겠습니까?')) return;
            try {
                await authFetch(API_ENDPOINTS.EXTERNAL + '/' + serviceType, { method:'DELETE' });
                showToast('연결이 해제되었습니다'); loadConnections();
            } catch (e) { showToast('해제 실패', 'error'); }
        }

        async function viewFiles(connectionId, label) {
            document.getElementById('filesTitle').textContent = label + ' - 캐시된 파일';
            document.getElementById('fileList').innerHTML = '<div class="loading">불러오는 중...</div>';
            document.getElementById('filesModal').classList.add('open');
            try {
                const res = await authFetch(API_ENDPOINTS.EXTERNAL + '/' + connectionId + '/files');
                const files = res.data || res || [];
                if (!files.length) {
                    document.getElementById('fileList').innerHTML = '<div class="empty-state">파일이 없습니다</div>';
                    return;
                }
                document.getElementById('fileList').innerHTML = files.map(f => `
                    <div class="file-item">
                        <div>
                            <div class="file-name">${esc(f.name || f.fileName || f.file_name || '-')}</div>
                            <div class="file-meta">${esc(f.mimeType || f.mime_type || f.type || '')} ${f.size ? formatSize(f.size) : ''}</div>
                        </div>
                        <div class="file-meta">${f.modified_at || f.modifiedAt ? new Date(f.modified_at || f.modifiedAt).toLocaleDateString('ko') : ''}</div>
                    </div>`).join('');
            } catch (e) { document.getElementById('fileList').innerHTML = '<div class="empty-state">로드 실패</div>'; }
        }

        function closeFiles() { document.getElementById('filesModal').classList.remove('open'); }

        function formatSize(bytes) {
            if (!bytes) return '';
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / 1048576).toFixed(1) + ' MB';
        }

        renderServices();

            // Expose onclick-referenced functions globally
                if (typeof closeConnect === 'function') window.closeConnect = closeConnect;
                if (typeof submitConnect === 'function') window.submitConnect = submitConnect;
                if (typeof closeFiles === 'function') window.closeFiles = closeFiles;
                if (typeof viewFiles === 'function') window.viewFiles = viewFiles;
                if (typeof disconnect === 'function') window.disconnect = disconnect;
                if (typeof openConnect === 'function') window.openConnect = openConnect;
            } catch(e) {
                console.error('[PageModule:external] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.closeConnect; } catch(e) {}
                try { delete window.submitConnect; } catch(e) {}
                try { delete window.closeFiles; } catch(e) {}
                try { delete window.viewFiles; } catch(e) {}
                try { delete window.disconnect; } catch(e) {}
                try { delete window.openConnect; } catch(e) {}
        }
    };
})();
