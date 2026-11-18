/**
 * 컴포저의 기본 모델 동기화 — 서버 판정만 store 에 쓴다(2026-11-18 설계 §3.3).
 * D3: 키가 꺼진 채 새로 고침하면 auth-sync 의 선호 응답과 모델 목록 응답 중 늦게 온 쪽이 이겨
 * "조용히 로컬" 과 "키 꺼짐 오류" 가 갈렸다. 이제 도착 순서와 무관하게 자동('default')이다.
 */
import './dom-before-react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

import { useAppStore } from '../../apps/web/lib/store';
import { fetchModels } from '../../apps/web/lib/models-api';
import { useDefaultModelSync } from '../../apps/web/lib/default-model-sync';
import { syncAuthFromServer } from '../../apps/web/lib/auth-sync';

const GEMINI = 'gemini:gemini-2.5-flash';
type Sel = { saved: string | null; effective: string; status: string } | null;

/** 컴포저와 같은 질의 키·가드로 훅을 돌리는 최소 하네스 */
function Harness() {
  const currentUserId = useAppStore((s) => s.auth.currentUser?.id ?? null);
  const authResolved = useAppStore((s) => s.authResolved);
  const { data } = useQuery({
    queryKey: ['models', 'chat', currentUserId ?? 'guest'],
    queryFn: () => fetchModels({ chatOnly: true }),
  });
  useDefaultModelSync(data, authResolved && !!currentUserId);
  return null;
}

interface Server {
  selection: Sel;
  /** 선호 GET 을 붙잡아 둘 약속 */
  holdPrefs?: Promise<void>;
  /** 모델 목록 GET 을 붙잡아 둘 약속 */
  holdModels?: Promise<void>;
  puts: Array<Record<string, unknown>>;
  modelsGets: number;
}

async function mount(server: Server, opts: { signedIn: boolean; startModel: string }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/chat' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/models') {
      server.modelsGets++;
      if (server.holdModels) await server.holdModels;
      return Response.json({ success: true, data: { defaultModel: 'local-llm:qwen-test', models: [], defaultModelSelection: server.selection } });
    }
    if (url.pathname === '/api/auth/me') {
      return Response.json({ success: true, data: { user: opts.signedIn ? { id: 7, email: 'a@test', username: 'a', role: 'user' } : null } });
    }
    if (url.pathname === '/api/users/me/preferences' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      server.puts.push(body);
      if (typeof body.defaultModel === 'string') server.selection = { saved: body.defaultModel, effective: body.defaultModel, status: 'ok' };
      return Response.json({ success: true, data: { saved: true, preferences: body } });
    }
    if (url.pathname === '/api/users/me/preferences') {
      if (server.holdPrefs) await server.holdPrefs;
      return Response.json({ success: true, data: { preferences: { defaultModel: GEMINI } } });
    }
    return Response.json({ success: true, data: {} });
  };
  useAppStore.setState({ selectedModel: opts.startModel, authResolved: false, auth: { currentUser: null, isGuestMode: true } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.getElementById('root')!);
  const flush = async () => { for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
  });
  return {
    queryClient, flush,
    cleanup: async () => {
      await act(async () => root.unmount());
      queryClient.clear();
      globalThis.fetch = originalFetch;
      dom.window.close();
    },
  };
}

function gate() {
  let release!: () => void;
  const p = new Promise<void>((r) => { release = r; });
  return { p, release };
}

for (const order of ['목록 먼저 → 선호 나중', '선호 먼저 → 목록 나중'] as const) {
  test(`D3: 키 꺼진 채 새로 고침 — ${order} 어느 순서든 최종 selectedModel 은 'default'`, async () => {
    const prefs = gate();
    const models = gate();
    const server: Server = {
      selection: { saved: GEMINI, effective: 'default', status: 'key_disabled' },
      holdPrefs: prefs.p, holdModels: models.p, puts: [], modelsGets: 0,
    };
    const m = await mount(server, { signedIn: true, startModel: GEMINI });
    try {
      await act(async () => { await syncAuthFromServer(); });
      await m.flush();
      if (order === '목록 먼저 → 선호 나중') { models.release(); await m.flush(); prefs.release(); }
      else { prefs.release(); await m.flush(); models.release(); }
      await m.flush();
      assert.equal(useAppStore.getState().selectedModel, 'default');
      assert.equal(server.puts.length, 0, '저장값이 있으면 넘기기(PUT)를 하지 않는다');
    } finally {
      prefs.release(); models.release();
      await m.flush();
      await m.cleanup();
    }
  });
}

test('목록이 key_disabled → ok 로 다시 오면 selectedModel 이 saved 로 돌아온다', async () => {
  const server: Server = { selection: { saved: GEMINI, effective: 'default', status: 'key_disabled' }, puts: [], modelsGets: 0 };
  const m = await mount(server, { signedIn: true, startModel: GEMINI });
  try {
    await act(async () => { await syncAuthFromServer(); });
    await m.flush();
    assert.equal(useAppStore.getState().selectedModel, 'default');
    server.selection = { saved: GEMINI, effective: GEMINI, status: 'ok' };
    await act(async () => { await m.queryClient.invalidateQueries({ queryKey: ['models'] }); });
    await m.flush();
    assert.equal(useAppStore.getState().selectedModel, GEMINI);
  } finally {
    await m.cleanup();
  }
});

test('비로그인이면 store 를 쓰지 않는다(2026-09-08 가드 유지)', async () => {
  const server: Server = { selection: { saved: null, effective: 'default', status: 'auto' }, puts: [], modelsGets: 0 };
  const m = await mount(server, { signedIn: false, startModel: GEMINI });
  try {
    await act(async () => { await syncAuthFromServer(); });
    await m.flush();
    assert.ok(server.modelsGets > 0, '목록은 읽었다');
    assert.equal(useAppStore.getState().selectedModel, GEMINI);
    assert.equal(server.puts.length, 0);
  } finally {
    await m.cleanup();
  }
});

test('인증 미확정이면 목록이 와도 store 를 쓰지 않는다', async () => {
  const server: Server = { selection: { saved: GEMINI, effective: 'default', status: 'key_disabled' }, puts: [], modelsGets: 0 };
  const m = await mount(server, { signedIn: true, startModel: GEMINI });
  try {
    useAppStore.setState({ auth: { currentUser: { id: '7', email: 'a@test', name: 'a', role: 'user' }, isGuestMode: false } });
    await m.flush();
    assert.ok(server.modelsGets > 0);
    assert.equal(useAppStore.getState().selectedModel, GEMINI);
  } finally {
    await m.cleanup();
  }
});

test('저장 안 된 기존 선택(saved=null)은 1회 PUT 으로 넘기고 그 값으로 남는다', async () => {
  const server: Server = { selection: { saved: null, effective: 'default', status: 'auto' }, puts: [], modelsGets: 0 };
  // 선호 GET 은 defaultModel 을 주지만 auth-sync 는 더 이상 store 에 쓰지 않으므로 넘기기 대상은 store 값
  const m = await mount(server, { signedIn: true, startModel: 'hasa:ext-model' });
  try {
    await act(async () => { await syncAuthFromServer(); });
    await m.flush();
    assert.deepEqual(server.puts, [{ defaultModel: 'hasa:ext-model' }]);
    assert.equal(useAppStore.getState().selectedModel, 'hasa:ext-model');
    await act(async () => { await m.queryClient.invalidateQueries({ queryKey: ['models'] }); });
    await m.flush();
    assert.equal(server.puts.length, 1, '저장되면 다시 돌지 않는다');
  } finally {
    await m.cleanup();
  }
});
