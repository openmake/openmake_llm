// add-on 화면 레지스트리 — Base 의 catch-all 라우트(app/(workspace)/[...addonPath])가 쓰는 renderAddonPage 의 경로 판정.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { isValidElement, type ReactElement } from 'react';
import { WEB_ADDON_PAGES, renderAddonPage } from '../../apps/web/addons/pages';
import { SpaceDetail } from '../../apps/web/addons/knowledge/pages/space-detail';
import { SpaceListView } from '../../apps/web/addons/knowledge/pages/space-list';
import { ResearchPage } from '../../apps/web/addons/deep-research/pages/research-page';
import { SkillLibraryPage } from '../../apps/web/addons/skill-runtime/pages/skill-library-page';
import { McpCatalogPage } from '../../apps/web/addons/mcp-runtime/pages/mcp-catalog-page';
import { AdminMcpCatalogPage } from '../../apps/web/addons/mcp-runtime/pages/admin-mcp-catalog-page';
import { McpMonitoringPage } from '../../apps/web/addons/mcp-runtime/pages/admin-mcp-monitoring-page';
import { WEB_ADDONS } from '../../apps/web/addons/registry';

const element = (node: unknown): ReactElement<Record<string, unknown>> => {
  assert.ok(isValidElement(node), '화면 요소가 아니다');
  return node as ReactElement<Record<string, unknown>>;
};

/** 앱 안 링크(`/admin/x`·`/x?y`) → 그 링크를 받는 catch-all 라우트의 영역·조각 */
const renderHref = (href: string) => {
  const segs = href.split('?')[0].split('/').filter(Boolean);
  return segs[0] === 'admin' ? renderAddonPage(segs.slice(1), {}, undefined, 'admin') : renderAddonPage(segs, {});
};

/** next/navigation redirect 가 던지는 신호의 대상 주소 */
const redirectTarget = (fn: () => unknown): string | null => {
  try { fn(); } catch (e) {
    const digest = (e as { digest?: string }).digest ?? '';
    if (digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2] ?? null;
    throw e;
  }
  return null;
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

test('/skill-library·/mcp-catalog 는 그 add-on 화면, 하위 경로는 없다', () => {
  assert.equal(element(renderAddonPage(['skill-library'], {})).type, SkillLibraryPage);
  assert.equal(element(renderAddonPage(['mcp-catalog'], {})).type, McpCatalogPage);
  assert.equal(renderAddonPage(['skill-library', 'x'], {}), null);
  assert.equal(renderAddonPage(['mcp-catalog', 'x'], {}), null);
});

test('관리자 영역 화면은 /admin/* 에서만 — 같은 이름의 workspace 화면과 섞이지 않는다', () => {
  assert.equal(element(renderAddonPage(['mcp-catalog'], {}, undefined, 'admin')).type, AdminMcpCatalogPage);
  assert.equal(element(renderAddonPage(['mcp-monitoring'], {}, undefined, 'admin')).type, McpMonitoringPage);
  assert.equal(renderAddonPage(['skill-library'], {}, undefined, 'admin'), null);
  assert.equal(renderAddonPage(['research'], {}, undefined, 'admin'), null);
});

test('구 딥링크(/mcp-servers·/mcp-monitoring)는 옮긴 자리로 보낸다', () => {
  assert.equal(redirectTarget(() => renderAddonPage(['mcp-servers'], {})), '/settings?tab=connectors');
  assert.equal(redirectTarget(() => renderAddonPage(['mcp-monitoring'], {})), '/admin/mcp-monitoring');
  assert.equal(renderAddonPage(['mcp-servers', 'x'], {}), null);
});

test('add-on 이 다루지 않는 경로는 null — Base 가 404', () => {
  assert.equal(renderAddonPage(['knowledge', 'space-1', 'extra'], {}), null);
  assert.equal(renderAddonPage(['no-such-addon-page'], {}), null);
});

test('허브 탭·관리자 바로가기·`/` 메뉴 전체 보기로 끼운 add-on 링크는 등록된 add-on 화면을 가리킨다(죽은 링크 없음)', () => {
  const hrefs = [
    ...WEB_ADDONS.flatMap((a) => a.hubTabs ?? []).map((t) => t.href),
    ...WEB_ADDONS.flatMap((a) => a.adminQuickLinks ?? []).map((q) => q.href),
    ...WEB_ADDONS.flatMap((a) => (a.slashMenu ? [a.slashMenu.viewAllHref] : [])),
  ];
  for (const expected of ['/research', '/skill-library', '/admin/mcp-monitoring', '/admin/mcp-catalog', '/mcp-catalog']) {
    assert.ok(hrefs.includes(expected), expected);
  }
  for (const href of hrefs) {
    assert.notEqual(renderHref(href), null, `${href} 를 렌더할 화면이 없다`);
  }
});

test('add-on 이 끼우는 승인 섹션·설정 탭의 id 는 서로 겹치지 않는다', () => {
  const sections = WEB_ADDONS.flatMap((a) => a.approvalSections ?? []).map((x) => x.id);
  const tabs = WEB_ADDONS.flatMap((a) => a.settingsTabs ?? []).map((x) => x.id);
  assert.equal(new Set(sections).size, sections.length);
  assert.equal(new Set(tabs).size, tabs.length);
  // Base 승인 섹션(tasks·agents)·설정 탭과도 겹치지 않는다
  for (const id of ['tasks', 'agents']) assert.ok(!sections.includes(id), id);
  for (const id of ['general', 'model', 'interface', 'notifications', 'memory', 'extensions', 'privacy', 'security']) assert.ok(!tabs.includes(id), id);
  // `/` 메뉴는 첫 번째 것만 쓰이므로 둘 이상이면 조용히 무시된다
  assert.ok(WEB_ADDONS.filter((a) => a.slashMenu).length <= 1);
});

test('관리자 add-on catch-all 은 관리자 가드 레이아웃 밖에 있고 가드를 직접 쓴다 — 안에 두면 없는 경로가 404 가 아니라 200', () => {
  const ws = resolve(process.cwd(), 'apps/web/app/(workspace)');
  assert.ok(!existsSync(resolve(ws, 'admin/[...addonPath]')), '가드 레이아웃 안에 catch-all 이 있다');
  assert.match(readFileSync(resolve(ws, '(admin-addons)/admin/[...addonPath]/page.tsx'), 'utf8'), /<AdminGuard>\{page\}<\/AdminGuard>/);
});

test('레지스트리에서 뺀 add-on 의 화면은 렌더되지 않는다', () => {
  assert.equal(renderAddonPage(['knowledge'], {}, []), null);
});

test('add-on 화면 경로는 Base 의 정적 라우트·다른 add-on 과 겹치지 않는다(겹치면 정적 라우트가 조용히 이긴다)', () => {
  const staticRoutes = (dir: string) => new Set(readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('[') && !e.name.startsWith('('))
    .map((e) => e.name));
  const workspaceRoutes = staticRoutes('apps/web/app/(workspace)');
  const adminRoutes = staticRoutes('apps/web/app/(workspace)/admin');
  const ofArea = (area: 'workspace' | 'admin') => WEB_ADDON_PAGES.filter((p) => (p.area ?? 'workspace') === area).map((p) => p.path);
  assert.deepEqual(ofArea('workspace').filter((p) => workspaceRoutes.has(p)), []);
  assert.deepEqual(ofArea('admin').filter((p) => adminRoutes.has(p)), []);
  // workspace 의 `admin` 은 관리자 영역 자리라 쓸 수 없다
  assert.ok(!ofArea('workspace').includes('admin'));
  const keys = WEB_ADDON_PAGES.map((p) => `${p.area ?? 'workspace'}:${p.path}`);
  assert.equal(new Set(keys).size, keys.length);
});
