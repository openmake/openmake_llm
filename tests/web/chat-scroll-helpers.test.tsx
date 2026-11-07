/**
 * 채팅 자동 스크롤은 메시지 목록의 스크롤 컨테이너만 움직인다 — scrollIntoView 는 overflow-hidden 인
 * 앱 셸·main 까지 밀어 올려 사이드바·입력창이 화면 밖으로 밀린 채 남았다(2026-11-08 운영 캡처).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { findScroller, scrollToBottomOf } from '../../apps/web/lib/chat-scroll';

function setup() {
  const dom = new JSDOM(
    `<div id="shell" style="overflow: hidden">
       <main id="main" style="overflow: hidden">
         <div id="scroller" style="overflow-y: auto">
           <div id="list"><div id="sentinel"></div></div>
         </div>
       </main>
     </div>`,
    { url: 'http://localhost/' },
  );
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  });
  const byId = (id: string) => dom.window.document.getElementById(id) as HTMLElement;
  const intoViewCalls: unknown[] = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, arg?: unknown) {
    intoViewCalls.push([this.id, arg]);
  };
  return { dom, byId, intoViewCalls };
}

test('findScroller 는 overflow-y auto 조상을 고르고 바깥 overflow hidden 조상은 고르지 않는다', () => {
  const { dom, byId } = setup();
  try {
    assert.equal(findScroller(byId('sentinel')), byId('scroller'));
    assert.equal(findScroller(byId('scroller')), null, 'hidden 셸·main 은 스크롤러가 아니다');
  } finally {
    dom.window.close();
  }
});

test('scrollToBottomOf 는 스크롤러의 scrollTop 만 scrollHeight 로 두고 셸·main 은 건드리지 않는다', () => {
  const { dom, byId, intoViewCalls } = setup();
  try {
    const scroller = byId('scroller');
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1200 });
    scrollToBottomOf(findScroller(byId('sentinel')));
    assert.equal(scroller.scrollTop, 1200);
    assert.equal(byId('main').scrollTop, 0);
    assert.equal(byId('shell').scrollTop, 0);
    assert.deepEqual(intoViewCalls, []);
  } finally {
    dom.window.close();
  }
});

test('널 입력은 아무것도 하지 않는다', () => {
  const { dom } = setup();
  try {
    assert.equal(findScroller(null), null);
    assert.doesNotThrow(() => scrollToBottomOf(null));
  } finally {
    dom.window.close();
  }
});
