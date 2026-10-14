/**
 * 예약 task 산출물 게시(publishScheduleOutput) — workspace 의 report.html 을 <게시 루트>/<slug>/{날짜,latest}.html 로 복사한다.
 * 게시 대상 아님·잘못된 slug·산출물 없음 → null(throw 없음). 게시 디렉터리 쓰기 실패는 reject 한다 —
 * 호출자(schedule-runner publishCompleted)가 try/catch 로 삼키는 계약이다.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const mockLimits = {
    SCHEDULE_PUBLISH_DIR: '',
    SCHEDULE_PUBLISH_URL_PREFIX: '/generated/reports',
    SCHEDULE_PUBLISH_FILE: 'report.html',
    SCHEDULE_PUBLISH_TZ: 'Asia/Seoul',
};
jest.mock('../../../config/runtime-limits', () => ({ get AGENT_TASK_LIMITS() { return mockLimits; } }));
const warn = jest.fn();
jest.mock('../../../utils/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: (m: string) => warn(m), error: jest.fn() }),
}));

import { publishScheduleOutput } from '../schedule-publish';

let scratch: string;
let workspace: string;
let publishDir: string;
const NOW = new Date('2026-10-14T16:30:00Z'); // 서울 기준 2026-10-15 01:30

beforeEach(async () => {
    jest.clearAllMocks();
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'schedule-publish-test-'));
    workspace = path.join(scratch, 'ws');
    publishDir = path.join(scratch, 'public', 'reports');
    await fs.mkdir(workspace, { recursive: true });
    Object.assign(mockLimits, {
        SCHEDULE_PUBLISH_DIR: publishDir,
        SCHEDULE_PUBLISH_URL_PREFIX: '/generated/reports',
        SCHEDULE_PUBLISH_FILE: 'report.html',
        SCHEDULE_PUBLISH_TZ: 'Asia/Seoul',
    });
});

afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
});

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const writeReport = (body: string, name = 'report.html') => fs.writeFile(path.join(workspace, name), body);

describe('publishScheduleOutput — 게시 대상이 아니면 아무것도 하지 않는다', () => {
    it.each([
        ['slug null', null, 'ws'],
        ['slug undefined', undefined, 'ws'],
        ['slug 빈 문자열', '', 'ws'],
        ['workspace null', 'daily', null],
        ['workspace undefined', 'daily', undefined],
        ['workspace 빈 문자열', 'daily', ''],
    ])('%s → null, 게시 디렉터리를 만들지 않는다', async (_n, slug, ws) => {
        await writeReport('<p>x</p>');
        const wsPath = ws === 'ws' ? workspace : ws;
        await expect(publishScheduleOutput(slug, wsPath, NOW)).resolves.toBeNull();
        expect(await exists(publishDir)).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    it.each(['../escape', 'a/b', 'a\\b', 'a.b', '한글', 'with space', 'x'.repeat(65)])('잘못된 slug %p 는 무시하고 경고만', async (slug) => {
        await writeReport('<p>x</p>');
        await expect(publishScheduleOutput(slug, workspace, NOW)).resolves.toBeNull();
        expect(await exists(publishDir)).toBe(false);
        expect(await exists(path.join(scratch, 'public', 'escape'))).toBe(false);
        expect(warn.mock.calls[0][0]).toContain('잘못된 slug');
    });

    it('산출물이 없으면 null 이고 기존 latest 를 그대로 둔다', async () => {
        await fs.mkdir(path.join(publishDir, 'daily'), { recursive: true });
        await fs.writeFile(path.join(publishDir, 'daily', 'latest.html'), 'yesterday');
        await expect(publishScheduleOutput('daily', workspace, NOW)).resolves.toBeNull();
        expect(await fs.readFile(path.join(publishDir, 'daily', 'latest.html'), 'utf8')).toBe('yesterday');
        expect(warn.mock.calls[0][0]).toContain('산출물 없음');
    });

    it('workspace 자체가 없어도 throw 하지 않고 null', async () => {
        await expect(publishScheduleOutput('daily', path.join(scratch, 'gone'), NOW)).resolves.toBeNull();
    });
});

describe('publishScheduleOutput — 게시', () => {
    it('날짜본과 latest 로 복사하고 공개 URL 을 돌려준다', async () => {
        await writeReport('<h1>리포트</h1>');
        await expect(publishScheduleOutput('daily-news', workspace, NOW)).resolves.toBe('/generated/reports/daily-news/latest.html');
        const dir = path.join(publishDir, 'daily-news');
        expect((await fs.readdir(dir)).sort()).toEqual(['2026-10-15.html', 'latest.html']);
        expect(await fs.readFile(path.join(dir, 'latest.html'), 'utf8')).toBe('<h1>리포트</h1>');
        expect(await fs.readFile(path.join(dir, '2026-10-15.html'), 'utf8')).toBe('<h1>리포트</h1>');
    });

    it('옮기지 않고 복사한다 — workspace 의 원본이 남는다', async () => {
        await writeReport('orig');
        await publishScheduleOutput('daily', workspace, NOW);
        expect(await fs.readFile(path.join(workspace, 'report.html'), 'utf8')).toBe('orig');
    });

    it('바이트를 그대로 옮긴다(이진 내용)', async () => {
        const bin = Buffer.from([0, 255, 1, 254, 0x0a, 0x0d]);
        await fs.writeFile(path.join(workspace, 'report.html'), bin);
        await publishScheduleOutput('bin', workspace, NOW);
        expect(Buffer.compare(await fs.readFile(path.join(publishDir, 'bin', 'latest.html')), bin)).toBe(0);
    });

    it('날짜는 게시 TZ 기준이다', async () => {
        await writeReport('a');
        mockLimits.SCHEDULE_PUBLISH_TZ = 'UTC';
        await publishScheduleOutput('utc', workspace, NOW);
        expect(await exists(path.join(publishDir, 'utc', '2026-10-14.html'))).toBe(true);
    });

    it('다음 날 게시는 latest 를 덮고 전날 날짜본은 남긴다', async () => {
        await writeReport('day1');
        await publishScheduleOutput('daily', workspace, NOW);
        await writeReport('day2');
        await publishScheduleOutput('daily', workspace, new Date(NOW.getTime() + 24 * 3600 * 1000));
        const dir = path.join(publishDir, 'daily');
        expect(await fs.readFile(path.join(dir, 'latest.html'), 'utf8')).toBe('day2');
        expect(await fs.readFile(path.join(dir, '2026-10-15.html'), 'utf8')).toBe('day1');
        expect(await fs.readFile(path.join(dir, '2026-10-16.html'), 'utf8')).toBe('day2');
    });

    it('같은 날 다시 게시하면 그날 날짜본도 덮는다', async () => {
        await writeReport('first');
        await publishScheduleOutput('daily', workspace, NOW);
        await writeReport('second');
        await publishScheduleOutput('daily', workspace, NOW);
        expect(await fs.readFile(path.join(publishDir, 'daily', '2026-10-15.html'), 'utf8')).toBe('second');
    });

    it('경계 slug(영숫자·하이픈·밑줄, 64자)는 받는다', async () => {
        await writeReport('a');
        const slug = 'A_b-9'.padEnd(64, 'z');
        await expect(publishScheduleOutput(slug, workspace, NOW)).resolves.toBe(`/generated/reports/${slug}/latest.html`);
    });

    it('설정한 파일 이름·URL 접두사를 쓴다', async () => {
        mockLimits.SCHEDULE_PUBLISH_FILE = 'out/index.html';
        mockLimits.SCHEDULE_PUBLISH_URL_PREFIX = '/r';
        await fs.mkdir(path.join(workspace, 'out'));
        await writeReport('nested', 'out/index.html');
        await expect(publishScheduleOutput('s', workspace, NOW)).resolves.toBe('/r/s/latest.html');
        expect(await fs.readFile(path.join(publishDir, 's', 'latest.html'), 'utf8')).toBe('nested');
    });

    it('게시 디렉터리를 만들 수 없으면 reject 한다(호출자가 삼키는 계약)', async () => {
        await writeReport('a');
        const blocker = path.join(scratch, 'blocker');
        await fs.writeFile(blocker, 'not a dir');
        mockLimits.SCHEDULE_PUBLISH_DIR = path.join(blocker, 'reports');
        await expect(publishScheduleOutput('daily', workspace, NOW)).rejects.toThrow(/ENOTDIR|EEXIST/);
    });
});
