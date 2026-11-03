import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import ko from '../../apps/web/messages/ko.json';
import { ArtifactPanel } from '../../apps/web/components/chat/artifact-panel';
import { useAppStore } from '../../apps/web/lib/store';

const STORAGE_KEY = 'omk_artifact_panel_w';

async function mount(saved: string | null, innerWidth: number) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.defineProperty(dom.window, 'innerWidth', { value: innerWidth, configurable: true });
  if (saved !== null) dom.window.localStorage.setItem(STORAGE_KEY, saved);
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    artifacts: [{ id: 'a1', kind: 'markdown', title: 'Doc', lang: null, content: 'hello', streaming: false }],
    activeArtifactId: 'a1',
    artifactPanelOpen: true,
  });
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(<NextIntlClientProvider locale="ko" messages={ko} timeZone="Asia/Seoul"><ArtifactPanel /></NextIntlClientProvider>);
  });
  const panelWidth = () => (document.querySelector('aside') as HTMLElement).style.getPropertyValue('--panel-w');
  return {
    panelWidth,
    cleanup: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test('saved panel width wider than the viewport allows is clamped on restore', async () => {
  const { panelWidth, cleanup } = await mount('1300', 1470);
  try {
    assert.equal(panelWidth(), '1070px');
  } finally {
    await cleanup();
  }
});

test('saved panel width within the viewport limit is restored as is', async () => {
  const { panelWidth, cleanup } = await mount('500', 1470);
  try {
    assert.equal(panelWidth(), '500px');
  } finally {
    await cleanup();
  }
});

test('panel uses the default width when nothing is saved', async () => {
  const { panelWidth, cleanup } = await mount(null, 1470);
  try {
    assert.equal(panelWidth(), '560px');
  } finally {
    await cleanup();
  }
});
