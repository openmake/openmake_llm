import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, scanRepo, parseForbidden, shortForbidden, EXCLUDE } from './org-specific-strings.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('범용 규칙: 테일넷·DDNS 주소와 실제 계정 경로를 잡는다', () => {
    // 이 파일도 저장소 검사 대상이라 걸릴 문자열은 조각을 이어 만든다.
    const j = (...p) => p.join('');
    const hits = scanText([j('a https://box.tailabc123', '.ts.net:4321'), j('b http://home.tplink', 'dns.com:8080'), j('c /ho', 'me/realname/vllm'), j('d /Vol', 'umes/MyDisk/app')].join('\n'));
    assert.deepEqual(hits.map((h) => `${h.line}:${h.rule}`), ['1:tailnet-host', '2:ddns-host', '3:personal-path', '4:personal-path']);
});

test('범용 규칙: 테스트·문서의 가상 이름 경로는 허용한다', () => {
    assert.deepEqual(scanText('/Users/alice/repo /home/user/x /Volumes/External/Colima /Users/x/.colima ~/vllm /home/<user>/vllm'), []);
});

test('조직 목록은 대소문자를 가리지 않고 잡되 값은 보고하지 않는다', () => {
    const hits = scanText('ok\nVisit Chat.Corp.Example now', parseForbidden(' corp.example , ,secret-host '));
    assert.deepEqual(hits, [{ rule: 'forbidden#1', line: 2 }]);
});

test('저장소: 범용 규칙에 걸리는 추적 파일이 없다', () => {
    const hits = scanRepo(root);
    assert.deepEqual(hits.map((h) => `${h.file}:${h.line} ${h.rule} ${h.match ?? ''}`), []);
});

test('조직 목록은 앞뒤가 영숫자가 아닐 때만 일치한다 — 도메인·메일·하이픈 이름은 잡고 단어 속 일부는 넘긴다', () => {
    const list = parseForbidden('corp.example,box-01,@mail.example');
    const lines = [
        'https://chat.corp.example/x',       // 1 도메인(앞 '.')
        'ops@corp.example',                   // 2 메일(앞 '@')
        'ssh box-01 && box-01-backup',        // 3 하이픈 이름(뒤 공백·'-')
        'noreply@mail.example',               // 4 '@' 로 시작하는 항목
        'notcorp.example decorp.examples',    // 5 영숫자에 붙은 일부 — 넘긴다
        'mybox-01 box-012',                   // 6 영숫자에 붙은 일부 — 넘긴다
    ];
    assert.deepEqual(scanText(lines.join('\n'), list).map((h) => `${h.line}:${h.rule}`), ['1:forbidden#1', '2:forbidden#1', '3:forbidden#2', '4:forbidden#3']);
});

test('3자 이하 항목은 검사하지 않고 번호만 알린다(번호는 목록 순서 그대로)', () => {
    const list = parseForbidden('ab,corp.example,xyz');
    assert.deepEqual(shortForbidden(list), [1, 3]);
    assert.deepEqual(scanText('em xyz ab corp.example', list), [{ rule: 'forbidden#2', line: 1 }]);
});

test('조직 목록은 쉼표와 줄바꿈 모두로 나눈다', () => {
    assert.deepEqual(parseForbidden('corp.example\nbox-01,\r\nmail.example\n'), ['corp.example', 'box-01', 'mail.example']);
});

test('제외: 현재 있는 마이그레이션(195 이하)과 그 rollback 만 — 새 마이그레이션은 검사한다', () => {
    const excluded = (f) => EXCLUDE.some((re) => re.test(f));
    assert.equal(excluded('db/migrations/001_baseline.sql'), true);
    assert.equal(excluded('db/migrations/195_token_blacklist_reason.sql'), true);
    assert.equal(excluded('db/migrations/rollbacks/195_token_blacklist_reason_rollback.sql'), true);
    assert.equal(excluded('db/migrations/196_new_feature.sql'), false);
    assert.equal(excluded('db/migrations/rollbacks/196_new_feature_rollback.sql'), false);
    assert.equal(excluded('db/migrations/README.md'), false);
});

test('개인 메일: 무료 메일 주소를 잡는다 — 제외 파일(README 등)에서도 잡는다', () => {
    const j = (...p) => p.join('');
    const hits = scanText([j('a someone@gm', 'ail.com'), j('b x.y@nav', 'er.com'), j('c ok support@example.com'), j('d z@hanm', 'ail.net')].join('\n'));
    assert.deepEqual(hits.map((h) => `${h.line}:${h.rule}`), ['1:personal-email', '2:personal-email', '4:personal-email']);
    // 제외 파일은 개인 메일 규칙만 적용한다 — 범용 경로 규칙은 넘긴다
    const only = scanText([j('a someone@gm', 'ail.com'), j('b /ho', 'me/realname/x')].join('\n'), [], { personalOnly: true });
    assert.deepEqual(only.map((h) => `${h.line}:${h.rule}`), ['1:personal-email']);
});

test('저장소: 제외 파일(README·CHANGELOG·마이그레이션)에도 개인 메일이 없다', () => {
    const hits = scanRepo(root).filter((h) => h.rule === 'personal-email');
    assert.deepEqual(hits.map((h) => `${h.file}:${h.line}`), []);
});
