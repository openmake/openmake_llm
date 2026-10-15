/**
 * Discord 게시용 문자열 다듬기 — 마크다운 표를 굵은 제목 + 목록으로 바꾸기, 2000자 분할.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertTablesForDiscord, splitForDiscord } from './message-utils';

test('표가 없으면 그대로 돌려준다', () => {
    const text = '안녕하세요.\n\n- 항목 하나\n- 항목 둘\n\n끝.';
    assert.equal(convertTablesForDiscord(text), text);
    assert.equal(convertTablesForDiscord(''), '');
});

test('2열 표: 첫 셀은 굵은 제목, 내용 셀은 <br> 마다 목록 항목 — 기존 글머리는 떼어 낸다', () => {
    const input = [
        '| 구분 | 내용 |',
        '|------|------|',
        '| 품종 | 정확한 품종은 사진만으로 판단하기 어렵습니다 |',
        '| 외모 | - 털 색: 연한 갈색(라이트 브라운)<br>- 털 결: 곱슬<br/>- 눈: 검은색 |',
        '| 옷차림 | • 빨간 조끼<BR />· 목줄 |',
        '| 배경 | 잔디밭 |',
    ].join('\n');
    const expected = [
        '**품종**',
        '- 정확한 품종은 사진만으로 판단하기 어렵습니다',
        '',
        '**외모**',
        '- 털 색: 연한 갈색(라이트 브라운)',
        '- 털 결: 곱슬',
        '- 눈: 검은색',
        '',
        '**옷차림**',
        '- 빨간 조끼',
        '- 목줄',
        '',
        '**배경**',
        '- 잔디밭',
    ].join('\n');
    assert.equal(convertTablesForDiscord(input), expected);
});

test('3열 이상: 항목 앞에 머리 이름을 붙이고, 여러 조각이면 나머지는 하위 항목', () => {
    const input = [
        '| 이름 | 나이 | 특징 |',
        '| --- | --- | --- |',
        '| 철수 | 20 | 키 큼<br>안경 |',
        '| **영희** | | 활발함 |',
    ].join('\n');
    const expected = [
        '**철수**',
        '- 나이: 20',
        '- 특징: 키 큼',
        '  - 안경',
        '',
        '**영희**',
        '- 특징: 활발함',
    ].join('\n');
    assert.equal(convertTablesForDiscord(input), expected);
});

test('정렬 콜론 구분 행, 앞뒤 파이프 없는 표', () => {
    assert.equal(convertTablesForDiscord('| 항목 | 값 |\n|:---|---:|\n| 가 | 1 |'), '**가**\n- 1');
    assert.equal(convertTablesForDiscord('항목 | 값\n:-: | -\n가 | 1\n나 | 2'), '**가**\n- 1\n\n**나**\n- 2');
});

test('이스케이프된 \\| 는 셀 안의 글자 | 로 복원한다', () => {
    assert.equal(convertTablesForDiscord('| 연산 | 뜻 |\n|---|---|\n| a \\| b | 논리합 |'), '**a | b**\n- 논리합');
});

test('셀 수가 머리와 달라도 깨지지 않는다 — 모자라면 빈 셀, 넘치면 머리 없이 값만', () => {
    const input = '| 이름 | 나이 | 직업 |\n|---|---|---|\n| 철수 | 20 |\n| 영희 | 21 | 학생 | 덤 |';
    assert.equal(convertTablesForDiscord(input), '**철수**\n- 나이: 20\n\n**영희**\n- 나이: 21\n- 직업: 학생\n- 덤');
});

test('1열 표는 행마다 목록 한 줄', () => {
    assert.equal(convertTablesForDiscord('| 할 일 |\n|---|\n| 장보기 |\n| 청소 |'), '- 장보기\n- 청소');
});

test('코드 펜스 안의 표는 바꾸지 않는다', () => {
    const fenced = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```';
    assert.equal(convertTablesForDiscord(fenced), fenced);
    const tilde = '~~~md\n| a | b |\n|---|---|\n| 1 | 2 |\n~~~\n\n| x | y |\n|---|---|\n| 3 | 4 |';
    assert.equal(convertTablesForDiscord(tilde), '~~~md\n| a | b |\n|---|---|\n| 1 | 2 |\n~~~\n\n**3**\n- 4');
});

test('구분 행 없는 파이프 줄은 표가 아니다', () => {
    const text = 'a | b\n선택지는 예 | 아니오 입니다.\n---';
    assert.equal(convertTablesForDiscord(text), text);
    assert.equal(convertTablesForDiscord('a | b'), 'a | b');
});

test('표 앞뒤 텍스트는 보존하고, 붙어 있으면 빈 줄을 하나 넣는다', () => {
    const input = '요약입니다.\n| 구분 | 내용 |\n|---|---|\n| 품종 | 푸들 |\n이상입니다.';
    assert.equal(convertTablesForDiscord(input), '요약입니다.\n\n**품종**\n- 푸들\n\n이상입니다.');
    const spaced = '요약입니다.\n\n| 구분 | 내용 |\n|---|---|\n| 품종 | 푸들 |\n\n이상입니다.';
    assert.equal(convertTablesForDiscord(spaced), '요약입니다.\n\n**품종**\n- 푸들\n\n이상입니다.');
});

test('표 바로 뒤의 이스케이프된 파이프만 있는 줄은 본문 행이 아니다', () => {
    const input = '| 구분 | 내용 |\n|---|---|\n| 품종 | 푸들 |\n참고: a \\| b 는 표가 아니다';
    assert.equal(convertTablesForDiscord(input), '**품종**\n- 푸들\n\n참고: a \\| b 는 표가 아니다');
    const lone = '참고: a \\| b\n|---|';
    assert.equal(convertTablesForDiscord(lone), lone);
});

test('splitForDiscord: 한도 안이면 그대로, 넘으면 줄바꿈 경계에서 나눈다', () => {
    assert.deepEqual(splitForDiscord('짧은 글', 10), ['짧은 글']);
    assert.deepEqual(splitForDiscord('aaaa\nbbbb\ncccc', 10), ['aaaa\nbbbb', 'cccc']);
});
