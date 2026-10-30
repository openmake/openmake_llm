import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, scanRepo, parseForbidden } from './org-specific-strings.mjs';

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
