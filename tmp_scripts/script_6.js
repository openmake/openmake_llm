const API_BASE = window.location.origin;

        // 저장된 테마 적용
        function initTheme() {
            const savedTheme = localStorage.getItem('theme') || 'dark';
            document.documentElement.setAttribute('data-theme', savedTheme);
            updateThemeIcon(savedTheme);
        }

        function toggleTheme() {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
        }

        function updateThemeIcon(theme) {
            const icon = document.getElementById('themeIcon');
            icon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }

        initTheme();

        // 🔒 로그인 상태 확인: 이미 인증되었으면 홈으로 리다이렉트
        // httpOnly 쿠키로 인증 상태 확인 후 localStorage 정리 여부 결정
        (async function checkAuthAndRedirect() {
            try {
                const res = await fetch('/api/auth/me', { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json();
                    const user = data.data?.user || data.user;
                    if (user && user.email) {
                        // 이미 로그인됨 → 홈으로 이동
                        console.log('[Login] 이미 인증됨, 홈으로 리다이렉트:', user.email);
                        window.location.href = '/';
                        return;
                    }
                }
            } catch (e) {
                // 네트워크 오류 — 무시
            }
            // 인증 안 됨 → stale localStorage 정리
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            localStorage.removeItem('guestMode');
        })();

        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelector(`.tab:${tab === 'login' ? 'first-child' : 'last-child'}`).classList.add('active');

            document.getElementById('loginPanel').classList.toggle('active', tab === 'login');
            document.getElementById('registerPanel').classList.toggle('active', tab === 'register');

            hideMessages();
        }

        function showError(message) {
            const el = document.getElementById('errorMessage');
            el.textContent = message;
            el.style.display = 'block';
            document.getElementById('successMessage').style.display = 'none';
        }

        function showSuccess(message) {
            const el = document.getElementById('successMessage');
            el.textContent = message;
            el.style.display = 'block';
            document.getElementById('errorMessage').style.display = 'none';
        }

        function hideMessages() {
            document.getElementById('errorMessage').style.display = 'none';
            document.getElementById('successMessage').style.display = 'none';
        }

        function setLoading(btnId, loading) {
            const btn = document.getElementById(btnId);
            if (loading) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner"></span> 처리 중...';
            } else {
                btn.disabled = false;
                btn.innerHTML = btnId === 'loginBtn' ? '로그인' : '가입하기';
            }
        }

        async function handleLogin(e) {
            e.preventDefault();
            hideMessages();

            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;

            setLoading('loginBtn', true);

            try {
                const res = await fetch(`${API_BASE}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    // api-response 표준 형식: data.data.token, data.data.user
                    const payload = data.data || data;
                    const token = payload.token;
                    localStorage.removeItem('guestMode');
                    localStorage.removeItem('isGuest');
                    // JWT에서 사용자 정보 추출하여 저장
                    if (payload.user) {
                        localStorage.setItem('user', JSON.stringify(payload.user));
                    } else {
                        try {
                            const base64Url = token.split('.')[1];
                            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                            }).join(''));
                            const userData = JSON.parse(jsonPayload);
                            localStorage.setItem('user', JSON.stringify({
                                id: userData.userId, email: userData.email, role: userData.role
                            }));
                        } catch (e) { console.error('JWT decode error:', e); }
                    }
                    showSuccess('로그인 성공! 잠시 후 이동합니다...');

                    // 🔒 Phase 3: 통합된 클레이밍 로직 (중복 제거)
                    // auth.js 모듈이 로드되어 있으면 공용 함수 사용, 아니면 인라인 처리
                    const anonSessionId = sessionStorage.getItem('anonSessionId');
                    if (anonSessionId && token) {
                        if (typeof window.claimAnonymousSession === 'function') {
                            await window.claimAnonymousSession(token);
                        } else {
                            try {
                                await fetch(`${API_BASE}/api/chat/sessions/claim`, {
                                    method: 'POST',
                                    credentials: 'include',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${token}`
                                    },
                                    body: JSON.stringify({ anonSessionId })
                                });
                                sessionStorage.removeItem('anonSessionId');
                                console.log('[Login] 익명 세션 이관 완료:', anonSessionId);
                            } catch (claimErr) {
                                console.warn('[Login] 익명 세션 이관 실패 (무시):', claimErr);
                            }
                        }
                    }

                    // redirectAfterLogin 지원
                    const redirectUrl = sessionStorage.getItem('redirectAfterLogin') || '/';
                    sessionStorage.removeItem('redirectAfterLogin');
                    setTimeout(() => {
                        window.location.href = redirectUrl;
                    }, 800);
                } else {
                    // api-response 에러 형식: data.error.message 또는 레거시 data.error (string)
                    const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                    showError(errorMsg || '로그인에 실패했습니다');
                }
            } catch (error) {
                showError('서버 연결에 실패했습니다');
            } finally {
                setLoading('loginBtn', false);
            }
        }

        async function handleRegister(e) {
            e.preventDefault();
            hideMessages();

            const username = document.getElementById('registerUsername').value.trim();
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            const passwordConfirm = document.getElementById('registerPasswordConfirm').value;

            if (!username || username.length < 3) {
                showError('사용자명은 3자 이상이어야 합니다');
                return;
            }

            if (password !== passwordConfirm) {
                showError('비밀번호가 일치하지 않습니다');
                return;
            }

            setLoading('registerBtn', true);

            try {
                const res = await fetch(`${API_BASE}/api/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, email, password })
                });

                const data = await res.json();

                if (res.ok && data.success) {
                    showSuccess('회원가입 완료! 로그인해주세요.');
                    setTimeout(() => {
                        switchTab('login');
                        document.getElementById('loginEmail').value = email;
                    }, 1500);
                } else {
                    const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                    showError(errorMsg || '회원가입에 실패했습니다');
                }
            } catch (error) {
                showError('서버 연결에 실패했습니다');
            } finally {
                setLoading('registerBtn', false);
            }
        }

        function continueAsGuest() {
            localStorage.setItem('guestMode', 'true');
            localStorage.setItem('isGuest', 'true');
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
            window.location.href = '/';
        }

        function loginWithGoogle() {
            window.location.href = `${API_BASE}/api/auth/login/google`;
        }

        function loginWithGitHub() {
            window.location.href = `${API_BASE}/api/auth/login/github`;
        }

        async function checkOAuthProviders() {
            try {
                console.log('[Login] OAuth 프로바이더 확인 시작...');
                const res = await fetch(`${API_BASE}/api/auth/providers`);
                const data = await res.json();
                console.log('[Login] OAuth 프로바이더 응답:', data);

                // api-response 표준 형식: data.data.providers
                const payload = data.data || data;
                const providers = payload.providers || [];
                console.log('[Login] 활성 프로바이더:', providers);

                const section = document.getElementById('socialLoginSection');
                const divider = document.getElementById('divider1');

                if (providers.length === 0) {
                    console.log('[Login] 프로바이더 없음 - 섹션 숨김');
                    section.style.display = 'none';
                    if (divider) divider.style.display = 'none';
                } else {
                    const googleBtn = document.querySelector('.social-btn-google');
                    const githubBtn = document.querySelector('.social-btn-github');

                    console.log('[Login] Google 버튼 요소:', googleBtn);
                    console.log('[Login] Google 포함 여부:', providers.includes('google'));

                    if (googleBtn) {
                        googleBtn.style.display = providers.includes('google') ? 'flex' : 'none';
                    }
                    if (githubBtn) {
                        githubBtn.style.display = providers.includes('github') ? 'flex' : 'none';
                    }
                }
            } catch (e) {
                console.error('[Login] OAuth 프로바이더 확인 실패:', e);
            }
        }

        checkOAuthProviders();

        const urlParams = new URLSearchParams(window.location.search);
        const oauthError = urlParams.get('error');
        if (oauthError) {
            showError('소셜 로그인 실패: ' + oauthError);
        }