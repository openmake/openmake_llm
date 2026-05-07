import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = 'http://rasplay.tplinkdns.com:52416';
const user = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin', tier: 'enterprise' };
const pages = [
    ['history', '/history.html'],
    ['research', '/research.html'],
    ['documents', '/documents.html'],
    ['custom-agents', '/custom-agents.html'],
    ['skill-library', '/skill-library.html'],
    ['memory', '/memory.html'],
    ['usage', '/usage.html'],
    ['agent-learning', '/agent-learning.html'],
    ['api-keys', '/api-keys.html'],
    ['cluster', '/cluster.html'],
    ['admin', '/admin.html'],
    ['admin-metrics', '/admin-metrics.html'],
    ['audit', '/audit.html'],
    ['external', '/external.html'],
    ['analytics', '/analytics.html'],
    ['alerts', '/alerts.html'],
    ['password-change', '/password-change.html'],
    ['token-monitoring', '/token-monitoring.html'],
    ['uir-monitor', '/uir-monitor.html']
];

function json(body) {
    return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}
function sampleFor(url, method) {
    const u = new URL(url);
    const p = u.pathname;
    if (p === '/api/auth/me') return { success: true, data: { user } };
    if (p === '/api/auth/refresh') return { success: true, data: { token: 'mock.token.value' } };
    if (p === '/api/models') return { success: true, data: { models: [
        { id: 'gemma4:e4b', name: 'Gemma 4 E4B', provider: 'local', available: true },
        { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai', available: true },
        { id: 'claude-haiku', name: 'Claude Haiku', provider: 'external', available: false }
    ] } };
    if (p === '/api/chat/sessions') return { success: true, data: { sessions: [
        { id: 'c1', title: 'API 문서 개선 논의', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'c2', title: '문서 요약 워크플로우', createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date(Date.now() - 7200000).toISOString() }
    ] } };
    if (p.includes('/messages')) return { success: true, data: { messages: [
        { role: 'user', content: '사용량 대시보드에서 병목을 찾아줘' },
        { role: 'assistant', content: '요청 지연은 모델 라우팅과 큐 대기에서 발생합니다.' }
    ] } };
    if (p === '/api/documents') return { success: true, data: { documents: [
        { id: 'd1', filename: 'product-requirements.pdf', size: 1843200, type: 'application/pdf', created_at: new Date().toISOString(), status: 'processed' },
        { id: 'd2', filename: 'meeting-notes.md', size: 32200, type: 'text/markdown', created_at: new Date(Date.now() - 86400000).toISOString(), status: 'processed' }
    ] } };
    if (p === '/api/research/sessions') return { success: true, data: { sessions: [
        { id: 'r1', topic: '국내 LLM 서비스 UX 벤치마크', depth: 'standard', status: 'running', progress: 62, created_at: new Date().toISOString() },
        { id: 'r2', topic: 'API 과금 체계 비교', depth: 'deep', status: 'completed', progress: 100, created_at: new Date(Date.now() - 172800000).toISOString() }
    ] } };
    if (p.startsWith('/api/research/sessions/') && p.endsWith('/steps')) return { success: true, data: { steps: [
        { step_number: 1, step_type: 'search', query: 'LLM UX benchmark Korea', result: '관련 서비스 8개 수집' },
        { step_number: 2, step_type: 'synthesis', query: 'pricing dashboard patterns', result: '요금/토큰/성능 지표를 한 화면에 배치' }
    ] } };
    if (p.startsWith('/api/research/sessions/')) return { success: true, data: { session: { id: 'r1', topic: '국내 LLM 서비스 UX 벤치마크', depth: 'standard', status: 'running', progress: 62, summary: '핵심 UX는 빠른 모델 선택, 근거 표시, 비용 예측입니다.', key_findings: ['입력창과 모델 상태가 분리되어 인지 부하가 큼', '긴 문서 페이지는 목차 고정이 필요'], sources: ['sample source'] } } };
    if (p === '/api/agents/custom') return { success: true, data: { agents: [
        { id: 'a1', name: '코드 리뷰어', description: 'PR 리스크와 테스트 누락을 점검', category: 'development', is_active: true },
        { id: 'a2', name: '리서치 분석가', description: '웹 검색과 보고서 초안을 생성', category: 'research', is_active: true }
    ] } };
    if (p.includes('/api/agents/skills')) return { success: true, data: { skills: [
        { id: 's1', name: '웹 리서치', description: '근거 기반 자료 수집', category: 'research' },
        { id: 's2', name: '코드 생성', description: '구현 초안 작성', category: 'development' }
    ], categories: ['research', 'development'] } };
    if (p === '/api/memory') return { success: true, data: { memories: [
        { id: 'm1', content: '사용자는 한국어 응답을 선호합니다.', type: 'preference', created_at: new Date().toISOString() },
        { id: 'm2', content: '프로젝트는 npm workspaces 구조입니다.', type: 'project', created_at: new Date().toISOString() }
    ] } };
    if (p === '/api/usage' || p === '/api/usage/daily') return { success: true, data: { totalRequests: 1240, totalTokens: 482000, daily: [
        { date: '2026-05-01', requests: 110, tokens: 42000 },
        { date: '2026-05-02', requests: 196, tokens: 76000 },
        { date: '2026-05-03', requests: 172, tokens: 69000 }
    ] } };
    if (p === '/api/api-keys') return { success: true, data: { keys: [
        { id: 'k1', name: 'Production API', key_prefix: 'omk_live_7fa2', created_at: new Date().toISOString(), last_used_at: new Date().toISOString(), is_active: true },
        { id: 'k2', name: 'Staging API', key_prefix: 'omk_test_19bc', created_at: new Date().toISOString(), last_used_at: null, is_active: true }
    ] } };
    if (p === '/api/cluster' || p === '/api/cluster/status') return { success: true, data: { nodes: [
        { id: 'node-1', name: 'local-gpu-1', status: 'online', latency: 32, load: 44 },
        { id: 'node-2', name: 'remote-cpu-1', status: 'degraded', latency: 180, load: 81 }
    ], status: 'degraded' } };
    if (p === '/api/admin/users/stats' || p === '/api/admin/stats') return { success: true, data: { totalUsers: 42, activeUsers: 27, adminUsers: 2, conversations: 318 } };
    if (p === '/api/admin/users') return { success: true, data: { users: [
        { id: 'u1', email: 'admin@example.com', role: 'admin', is_active: true, created_at: new Date().toISOString() },
        { id: 'u2', email: 'user@example.com', role: 'user', is_active: true, created_at: new Date().toISOString() }
    ], pagination: { total: 2, page: 1, totalPages: 1 } } };
    if (p === '/api/admin/conversations') return { success: true, data: { conversations: [
        { id: 'cv1', user_email: 'user@example.com', title: '비용 최적화', message_count: 12, created_at: new Date().toISOString() }
    ], pagination: { total: 1, page: 1, totalPages: 1 } } };
    if (p === '/api/metrics') return { success: true, data: { system: { uptime: 84210, memoryUsage: { heapUsed: 286 * 1024 * 1024 }, activeConnections: 14 }, cluster: { nodes: [
        { id: 'node-1', name: 'local-gpu-1', status: 'online', latency: 32 },
        { id: 'node-2', name: 'remote-cpu-1', status: 'offline', latency: null }
    ] } } };
    if (p === '/api/monitoring/keys') return { success: true, data: { keys: [
        { index: 1, keyId: 'omk_live_****A91', isActive: true, failCount: 0 },
        { index: 2, keyId: 'omk_live_****C04', isActive: false, failCount: 2 }
    ] } };
    if (p === '/api/monitoring/quota') return { success: true, data: { warningLevel: 'warning', hourly: { used: 620, limit: 1000, percentage: 62 }, daily: { used: 7400, limit: 10000, percentage: 74 }, weekly: { used: 38200, limit: 70000, percentage: 55 } } };
    if (p === '/api/monitoring/summary') return { success: true, data: { today: { totalRequests: 1240, totalTokens: 482000 } } };
    if (p === '/api/monitoring/costs') return { success: true, data: { today: { totalCost: 18.7421, totalRequests: 1240, totalTokens: 482000 } } };
    if (p === '/api/monitoring/usage/hourly') return { success: true, data: { hourly: Array.from({ length: 12 }, (_, i) => ({ hour: i + 9, requests: 40 + i * 12, tokens: 11000 + i * 2100 })) } };
    if (p === '/api/monitoring/usage/daily') return { success: true, data: { daily: Array.from({ length: 7 }, (_, i) => ({ date: `05-${String(i + 1).padStart(2, '0')}`, requests: 120 + i * 30, tokens: 40000 + i * 6000 })) } };
    if (p === '/api/audit/actions') return { success: true, data: { actions: ['login', 'create_api_key', 'delete_document', 'admin_update_user'] } };
    if (p === '/api/audit') return { success: true, data: { logs: [
        { id: 'l1', action: 'login', user_email: 'admin@example.com', ip_address: '127.0.0.1', created_at: new Date().toISOString(), status: 'success' },
        { id: 'l2', action: 'create_api_key', user_email: 'user@example.com', ip_address: '127.0.0.1', created_at: new Date().toISOString(), status: 'success' }
    ], pagination: { total: 2, page: 1, totalPages: 1 } } };
    if (p === '/api/external') return { success: true, data: { connections: [
        { id: 'e1', service_type: 'github', account_name: 'openmake', status: 'connected', updated_at: new Date().toISOString() },
        { id: 'e2', service_type: 'notion', account_name: 'workspace', status: 'disconnected', updated_at: new Date().toISOString() }
    ] } };
    if (p === '/api/metrics/alerts') return { success: true, data: { alerts: [
        { id: 'al1', name: '토큰 사용량 80% 초과', severity: 'warning', enabled: true, channel: 'email' },
        { id: 'al2', name: '노드 오프라인', severity: 'critical', enabled: true, channel: 'slack' }
    ] } };
    return { success: true, data: {} };
}

const outDir = 'artifacts/ui-review/auth-current';
await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await context.addInitScript((u) => {
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('theme', 'dark');
    localStorage.removeItem('guestMode');
    localStorage.removeItem('isGuest');
}, user);
await context.route('**/api/**', route => route.fulfill(json(sampleFor(route.request().url(), route.request().method()))));

const results = [];
for (const [name, routePath] of pages) {
    const page = await context.newPage();
    await page.goto(base + routePath, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1800);
    const info = await page.evaluate(() => {
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 12);
        return {
            finalUrl: location.href,
            title: document.title,
            headings,
            textLength: text.length,
            text: text.slice(0, 1000),
            components: {
                cards: document.querySelectorAll('[class*="card"], .stat-card, .metric-card, .feature-card').length,
                tables: document.querySelectorAll('table').length,
                forms: document.querySelectorAll('form').length,
                inputs: document.querySelectorAll('input,textarea,select').length,
                charts: document.querySelectorAll('canvas,svg').length,
                buttons: document.querySelectorAll('button,[role="button"]').length
            }
        };
    });
    const shot = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => null);
    results.push({ name, route: routePath, screenshot: shot, ...info });
    await page.close();
}
await browser.close();
await fs.writeFile('artifacts/ui-review/auth-observations.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(r => ({ name: r.name, finalUrl: r.finalUrl, title: r.title, headings: r.headings, components: r.components })), null, 2));
