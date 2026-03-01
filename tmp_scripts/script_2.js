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
            const headers = { 'Content-Type':'application/json', ...options.headers };
            return fetch(url, { ...options, headers, credentials: 'include' }).then(r => r.json());
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
                const res = await authFetch('/api/external');
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
                await authFetch('/api/external', { method:'POST', body:JSON.stringify(body) });
                showToast('서비스가 연결되었습니다');
                closeConnect(); loadConnections();
            } catch (e) { showToast('연결 실패', 'error'); }
        }

        async function disconnect(serviceType) {
            if (!confirm('이 서비스 연결을 해제하시겠습니까?')) return;
            try {
                await authFetch('/api/external/' + serviceType, { method:'DELETE' });
                showToast('연결이 해제되었습니다'); loadConnections();
            } catch (e) { showToast('해제 실패', 'error'); }
        }

        async function viewFiles(connectionId, label) {
            document.getElementById('filesTitle').textContent = label + ' - 캐시된 파일';
            document.getElementById('fileList').innerHTML = '<div class="loading">불러오는 중...</div>';
            document.getElementById('filesModal').classList.add('open');
            try {
                const res = await authFetch('/api/external/' + connectionId + '/files');
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