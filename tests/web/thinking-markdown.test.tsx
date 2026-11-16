/**
 * 사고 패널 마크다운 — Gemini 사고 요약(`**제목**\n\n본문`)의 별표가 그대로 보이던 결함(2026-11-16 라이브).
 * 제한된 안전 마크다운: 굵게·기울임·코드·목록·인용만, 링크·이미지·표·raw HTML 은 요소로 나오지 않는다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import ko from '../../apps/web/messages/ko.json';
import { ThinkingMarkdown, splitThinkingParagraphs } from '../../apps/web/components/chat/thinking-markdown';
import { ThinkingTimeline } from '../../apps/web/components/chat/thinking-timeline';

const html = (text: string) => renderToStaticMarkup(<ThinkingMarkdown text={text} />);

test('굵게·기울임은 요소로 그리고 별표를 남기지 않는다', () => {
  const out = html('**Calculating the Product**\n\nI *think* so');
  assert.match(out, /<strong>Calculating the Product<\/strong>/);
  assert.match(out, /<em>think<\/em>/);
  assert.doesNotMatch(out, /\*\*/);
});

test('raw HTML·이미지·링크·표는 요소로 나오지 않는다', () => {
  const out = html('<img src="http://e.x/a.png" onerror="alert(1)"> <b>x</b>\n\n![고양이](http://e.x/c.png)\n\n[링크](http://e.x)\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.doesNotMatch(out, /<img|<a |<table|<b>|onerror="/);
  assert.match(out, /고양이/);
  assert.match(out, /링크/);
});

test('제목은 블록 굵은 글씨, 단락 안 줄바꿈은 p 에서만 유지(li 제외)', () => {
  const out = html('# 계획\n\n첫 줄\n둘째 줄\n\n- 항목 1\n- 항목 2');
  assert.doesNotMatch(out, /<h1/);
  assert.match(out, /<strong class="[^"]*block[^"]*">계획<\/strong>/);
  assert.match(out, /<p class="[^"]*whitespace-pre-line[^"]*">첫 줄\n둘째 줄<\/p>/);
  assert.match(out, /<li>항목 1<\/li>/);
});

test('단락이 나뉜 번호 목록은 원래 시작 번호를 유지한다 — 빈 줄로 띄운 2. 단락이 1. 로 보이지 않게', () => {
  const paras = splitThinkingParagraphs('1.  **Analyze:**\n    - sub a\n\n2.  **Decide:** do it\n\n3. Done');
  assert.equal(paras.length, 3);
  assert.match(html(paras[1]), /<ol start="2" class="[^"]*list-decimal[^"]*">/);
  assert.match(html(paras[2]), /<ol start="3" /);
  assert.doesNotMatch(html(paras[0]), /start=/);
});

test('코드 블록은 가로 스크롤 pre 로 그린다', () => {
  assert.match(html('```\nconst a = 1;\n```'), /<pre class="[^"]*overflow-x-auto[^"]*"><code>const a = 1;\n<\/code><\/pre>/);
});

test('splitThinkingParagraphs — 빈 줄로 나누되 코드펜스 안의 빈 줄은 나누지 않는다', () => {
  assert.deepEqual(splitThinkingParagraphs('a\n\n```\nx\n\ny\n```\n\n\nb\n'), ['a', '```\nx\n\ny\n```', 'b']);
  assert.deepEqual(splitThinkingParagraphs('  \n\n'), []);
});

test('ThinkingTimeline 이 단락을 마크다운으로 그린다', () => {
  const out = renderToStaticMarkup(
    <NextIntlClientProvider locale="ko" messages={ko} timeZone="Asia/Seoul">
      <ThinkingTimeline reasoning={'**Calculating the Product**\n\n곱을 계산한다'} thinkingActive done={false} />
    </NextIntlClientProvider>,
  );
  assert.match(out, /<strong>Calculating the Product<\/strong>/);
  assert.match(out, /곱을 계산한다/);
  assert.doesNotMatch(out, /\*\*/);
});
