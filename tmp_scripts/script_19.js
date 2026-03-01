const EMOJIS = ['🤖','🧠','💡','📝','🎨','🔬','📊','🛠️','💻','🎯','🔍','📚','✨','🌟','🎓','💼','🏗️','⚡','🔮','🧪'];
        const CAT_LABELS = { general:'일반', coding:'코딩', writing:'글쓰기', analysis:'분석', creative:'창작', education:'교육', business:'비즈니스', science:'과학' };
        let agents = [];
        let editingId = null;
        let selectedEmoji = '🤖';

        function authFetch(url, options = {}) {
            const headers = { 'Content-Type':'application/json', ...(options.headers || {}) };
            return fetch(url, { ...options, credentials: 'include', headers }).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        function initEmojiPicker() {
            document.getElementById('emojiPicker').innerHTML = EMOJIS.map(e =>
                '<span class="emoji-opt' + (e === selectedEmoji ? ' selected' : '') + '" data-e="' + e + '">' + e + '</span>'
            ).join('');
        }
        document.getElementById('emojiPicker').addEventListener('click', e => {
            const t = e.target.closest('.emoji-opt');
            if (!t) return;
            selectedEmoji = t.dataset.e;
            document.querySelectorAll('.emoji-opt').forEach(el => el.classList.remove('selected'));
            t.classList.add('selected');
        });

        document.getElementById('agentTemp').addEventListener('input', function() {
            document.getElementById('tempVal').textContent = this.value;
        });

        async function loadAgents() {
            try {
                const res = await authFetch('/api/agents/custom');
                agents = res.data || res || [];
                renderAgents();
            } catch (e) { showToast('에이전트 로드 실패', 'error'); }
        }

        function renderAgents() {
            const el = document.getElementById('agentList');
            if (!agents.length) {
                el.innerHTML = '<div class="empty-state"><h2>커스텀 에이전트가 없습니다</h2><p>새 에이전트를 만들어 시작하세요.</p></div>';
                return;
            }
            el.innerHTML = agents.map(a => `
                <div class="agent-card" onclick="openAgent('${a.id}')">
                    <div class="agent-emoji">${a.emoji || '🤖'}</div>
                    <h3>${esc(a.name)}</h3>
                    <div class="desc">${esc(a.description)}</div>
                    <div class="agent-meta">
                        <span class="badge badge-cat">${CAT_LABELS[a.category] || a.category || '일반'}</span>
                        <span class="badge ${a.enabled !== false ? 'badge-on' : 'badge-off'}">${a.enabled !== false ? '활성' : '비활성'}</span>
                        <span class="temp-label">온도 ${a.temperature != null ? a.temperature : '0.7'}</span>
                    </div>
                    <div class="card-actions">
                        <button onclick="event.stopPropagation();cloneAgent('${a.id}')">복제</button>
                        <button onclick="event.stopPropagation();confirmDelete('${a.id}')">삭제</button>
                    </div>
                </div>`).join('');
        }

        function openNew() {
            editingId = null; selectedEmoji = '🤖';
            document.getElementById('editorTitle').textContent = '새 에이전트';
            document.getElementById('agentName').value = '';
            document.getElementById('agentDesc').value = '';
            document.getElementById('agentPrompt').value = '';
            document.getElementById('agentKeywords').value = '';
            document.getElementById('agentCategory').value = 'general';
            document.getElementById('agentMaxTokens').value = '4096';
            document.getElementById('agentTemp').value = '0.7';
            document.getElementById('tempVal').textContent = '0.7';
            document.getElementById('agentEnabled').checked = true;
            document.getElementById('btnDelete').style.display = 'none';
            initEmojiPicker();
            document.getElementById('editorModal').classList.add('open');
        }

        async function openAgent(id) {
            try {
                const a = agents.find(x => x.id === id) || agents.find(x => String(x.id) === String(id));
                if (!a) return;
                editingId = a.id;
                selectedEmoji = a.emoji || '🤖';
                document.getElementById('editorTitle').textContent = '에이전트 편집';
                document.getElementById('agentName').value = a.name || '';
                document.getElementById('agentDesc').value = a.description || '';
                document.getElementById('agentPrompt').value = a.systemPrompt || '';
                document.getElementById('agentKeywords').value = (a.keywords || []).join(', ');
                document.getElementById('agentCategory').value = a.category || 'general';
                document.getElementById('agentMaxTokens').value = a.maxTokens || 4096;
                document.getElementById('agentTemp').value = a.temperature != null ? a.temperature : 0.7;
                document.getElementById('tempVal').textContent = a.temperature != null ? a.temperature : '0.7';
                document.getElementById('agentEnabled').checked = a.enabled !== false;
                document.getElementById('btnDelete').style.display = '';
                initEmojiPicker();
                document.getElementById('editorModal').classList.add('open');
            } catch (e) { showToast('로드 실패', 'error'); }
        }

        function closeEditor() { document.getElementById('editorModal').classList.remove('open'); }

        async function saveAgent() {
            const name = document.getElementById('agentName').value.trim();
            if (!name) { showToast('이름을 입력하세요', 'error'); return; }
            const body = {
                name,
                description: document.getElementById('agentDesc').value,
                systemPrompt: document.getElementById('agentPrompt').value,
                keywords: document.getElementById('agentKeywords').value.split(',').map(s => s.trim()).filter(Boolean),
                category: document.getElementById('agentCategory').value,
                emoji: selectedEmoji,
                temperature: parseFloat(document.getElementById('agentTemp').value),
                maxTokens: parseInt(document.getElementById('agentMaxTokens').value) || 4096,
                enabled: document.getElementById('agentEnabled').checked
            };
            try {
                if (editingId) {
                    await authFetch('/api/agents/custom/' + editingId, { method:'PUT', body:JSON.stringify(body) });
                    showToast('저장되었습니다');
                } else {
                    await authFetch('/api/agents/custom', { method:'POST', body:JSON.stringify(body) });
                    showToast('에이전트가 생성되었습니다');
                }
                closeEditor(); loadAgents();
            } catch (e) { showToast('저장 실패', 'error'); }
        }

        async function deleteAgent() {
            if (!editingId || !confirm('이 에이전트를 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/agents/custom/' + editingId, { method:'DELETE' });
                showToast('삭제되었습니다'); closeEditor(); loadAgents();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function confirmDelete(id) {
            if (!confirm('이 에이전트를 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/agents/custom/' + id, { method:'DELETE' });
                showToast('삭제되었습니다'); loadAgents();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function cloneAgent(id) {
            try {
                await authFetch('/api/agents/custom/' + id + '/clone', { method:'POST' });
                showToast('복제되었습니다'); loadAgents();
            } catch (e) { showToast('복제 실패', 'error'); }
        }

        loadAgents();