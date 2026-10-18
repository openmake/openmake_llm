// add-on 화면 레지스트리 — Base 의 catch-all 라우트(app/(workspace)/[...addonPath])가 쓰는 renderAddonPage 의 경로 판정.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { isValidElement, type ReactElement } from 'react';
import { WEB_ADDON_PAGES, renderAddonPage } from '../../apps/web/addons/pages';
import { SpaceDetail } from '../../apps/web/addons/knowledge/pages/space-detail';
import { SpaceListView } from '../../apps/web/addons/knowledge/pages/space-list';
import { ResearchPage } from '../../apps/web/addons/deep-research/pages/research-page';
import { WEB_ADDONS } from '../../apps/web/addons/registry';

const element = (node: unknown): ReactElement<Record<string, unknown>> => {
  assert.ok(isValidElement(node), '화면 요소가 아니다');
  return node as ReactElement<Record<string, unknown>>;
};

test('/knowledge 는 목록, /knowledge/<id> 는 상세(출처 칩의 doc·chunk 를 넘긴다)', () => {
  assert.equal(element(renderAddonPage(['knowledge'], {})).type, SpaceListView);
  const detail = element(renderAddonPage(['knowledge', 'space-1'], { doc: 'd1', chunk: 'c1' }));
  assert.equal(detail.type, SpaceDetail);
  assert.deepEqual(detail.props, { spaceId: 'space-1', docId: 'd1', chunkId: 'c1' });
  // 같은 키가 여러 번 오면 쓰지 않는다
  assert.deepEqual(element(renderAddonPage(['knowledge', 'space-1'], { doc: ['a', 'b'] })).props, { spaceId: 'space-1', docId: null, chunkId: null });
});

test('/research 는 딥리서치 화면, 하위 경로는 없다', () => {
  assert.equal(element(renderAddonPage(['research'], {})).type, ResearchPage);
  assert.equal(renderAddonPage(['research', 'x'], {}), null);
});

test('add-on 이 다루지 않는 경로는 null — Base 가 404', () => {
  assert.equal(renderAddonPage(['knowledge', 'space-1', 'extra'], {}), null);
  assert.equal(renderAddonPage(['no-such-addon-page'], {}), null);
});

test('허브 탭으로 끼운 add-on 링크는 등록된 add-on 화면을 가리킨다(죽은 링크 없음)', () => {
  const hrefs = WEB_ADDONS.flatMap((a) => a.hubTabs ?? []).map((t) => t.href);
  assert.ok(hrefs.includes('/research'));
  for (const href of hrefs) {
    assert.notEqual(renderAddonPage(href.split('/').filter(Boolean), {}), null, `${href} 를 렌더할 화면이 없다`);
  }
});

test('레지스트리에서 뺀 add-on 의 화면은 렌더되지 않는다', () => {
  assert.equal(renderAddonPage(['knowledge'], {}, []), null);
});

test('add-on 화면 경로는 Base 의 정적 라우트·다른 add-on 과 겹치지 않는다(겹치면 정적 라우트가 조용히 이긴다)', () => {
  const workspace = resolve(process.cwd(), 'apps/web/app/(workspace)');
  const staticRoutes = new Set(readdirSync(workspace, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('[') && !e.name.startsWith('('))
    .map((e) => e.name));
  const paths = WEB_ADDON_PAGES.map((p) => p.path);
  assert.deepEqual(paths.filter((p) => staticRoutes.has(p)), []);
  assert.equal(new Set(paths).size, paths.length);
});
