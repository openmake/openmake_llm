import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatScrollArea } from '../../apps/web/components/chat/chat-scroll-area';

async function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, self: dom.window, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true,
  });
  const root = createRoot(document.getElementById('root')!);
  await act(async () => {
    root.render(<ChatScrollArea><p id="content">messages</p></ChatScrollArea>);
  });
  const outer = document.getElementById('root')!.firstElementChild as HTMLElement;
  const scroller = outer.firstElementChild as HTMLElement;
  const calls: unknown[] = [];
  scroller.scrollBy = ((opts: ScrollToOptions) => { calls.push(opts); }) as typeof scroller.scrollBy;
  const wheel = async (target: Element, init: WheelEventInit) => {
    await act(async () => { target.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })); });
  };
  return {
    outer, calls, wheel,
    content: document.getElementById('content')!,
    cleanup: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test('wheel in the margin outside the column scrolls the inner scroller', async () => {
  const { outer, calls, wheel, cleanup } = await mount();
  try {
    await wheel(outer, { deltaY: 120 });
    assert.deepEqual(calls, [{ top: 120 }]);
  } finally {
    await cleanup();
  }
});

test('wheel inside the scroller is left to the browser', async () => {
  const { content, calls, wheel, cleanup } = await mount();
  try {
    await wheel(content, { deltaY: 120 });
    assert.equal(calls.length, 0);
  } finally {
    await cleanup();
  }
});

test('line-based wheel delta is converted to pixels', async () => {
  const { outer, calls, wheel, cleanup } = await mount();
  try {
    await wheel(outer, { deltaY: 120, deltaMode: 1 });
    assert.deepEqual(calls, [{ top: 120 * 16 }]);
  } finally {
    await cleanup();
  }
});
