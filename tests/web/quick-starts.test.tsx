import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import ko from '../../apps/web/messages/ko.json';
import en from '../../apps/web/messages/en.json';
import ja from '../../apps/web/messages/ja.json';
import zh from '../../apps/web/messages/zh.json';
import de from '../../apps/web/messages/de.json';
import { MessageList } from '../../apps/web/components/chat/message-list';
import { useAppStore } from '../../apps/web/lib/store';

const koreanDescriptions = [
  '요약할 글을 입력해 핵심 내용을 정리해요.',
  '궁금한 주제를 입력해 관련 내용을 자세히 알아봐요.',
  '문제를 입력해 단계별로 나누어 살펴봐요.',
  '주제를 입력해 다양한 아이디어와 접근법을 떠올려요.',
];
const locales = { ko, en, ja, zh, de };

async function mount(locale: keyof typeof locales) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  useAppStore.setState(useAppStore.getInitialState(), true);
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(<NextIntlClientProvider locale={locale} messages={locales[locale]} timeZone="Asia/Seoul"><MessageList /></NextIntlClientProvider>);
  });
  return async () => {
    await act(async () => root.unmount());
    dom.window.close();
  };
}

test('empty chat shows an explanation under each quick-start label', async () => {
  const cleanup = await mount('ko');
  try {
    for (const [index, start] of Object.values(ko.chat.quickStarts).entries()) {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(start.label));
      assert.ok(button, start.label);
      assert.ok(button.textContent?.includes(koreanDescriptions[index]), `${start.label} must show its explanation`);
    }
  } finally {
    await cleanup();
  }
});

for (const locale of Object.keys(locales) as (keyof typeof locales)[]) {
  test(`${locale}: descriptions remain visible and clicking them only prefills the original prompt`, async () => {
    const cleanup = await mount(locale);
    try {
      const buttons = [...document.querySelectorAll('button')];
      assert.equal(buttons.length, 4);
      for (const start of Object.values(locales[locale].chat.quickStarts)) {
        assert.ok(start.description.trim());
        const button = buttons.find((b) => b.textContent?.includes(start.label));
        assert.ok(button, start.label);
        const description = [...button.querySelectorAll('span')].find((s) => s.textContent === start.description);
        assert.ok(description, start.description);
        await act(async () => description.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
        assert.equal(useAppStore.getState().inputDraft, start.prompt);
        assert.deepEqual(useAppStore.getState().chatHistory, []);
        assert.equal(useAppStore.getState().isGenerating, false);
        assert.equal(useAppStore.getState().resendRequest, null);
      }
    } finally {
      await cleanup();
    }
  });
}

test('quick-start cards disappear once a conversation has messages', async () => {
  const cleanup = await mount('ko');
  try {
    await act(async () => useAppStore.setState({ chatHistory: [{ role: 'user', content: 'Hello' }] }));
    assert.ok(document.body.textContent?.includes('Hello'));
    for (const description of koreanDescriptions) assert.ok(!document.body.textContent?.includes(description));
  } finally {
    await cleanup();
  }
});
