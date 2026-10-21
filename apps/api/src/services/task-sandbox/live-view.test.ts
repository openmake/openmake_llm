/**
 * 실시간 작업 화면 읽기 — 에이전트가 작업 폴더의 숨김 파일을 마음대로 바꿀 수 있으므로
 * 없음·심링크 탈출·크기 초과·깨진 JSON·틀린 타입은 모두 그 부분만 null 로 떨어져야 한다.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { readLiveView } from './live-view';
import { LIVE_VIEW } from '../../config/agent-task-live-view';

let dir: string;
let outside: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'omk-live-'));
    outside = mkdtempSync(join(tmpdir(), 'omk-live-out-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
});

const writeMeta = (m: unknown) => writeFileSync(join(dir, LIVE_VIEW.META_FILE), JSON.stringify(m));
const META = { url: 'https://example.com/', title: '예시', at: 1700000000000 };
const TERMINAL = { command: 'ls', output: 'a\nb\n', truncatedHead: false, startedAt: 1, endedAt: 2, exitCode: 0 };

it('파일이 없으면 둘 다 null', async () => {
    expect(await readLiveView(dir)).toEqual({ browser: null, terminal: null });
});

it('meta 와 이미지가 있으면 base64 와 url·title·at', async () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    writeFileSync(join(dir, LIVE_VIEW.FRAME_FILE), jpg);
    writeMeta(META);
    writeFileSync(join(dir, LIVE_VIEW.TERMINAL_FILE), JSON.stringify(TERMINAL));
    expect(await readLiveView(dir)).toEqual({ browser: { image: jpg.toString('base64'), ...META }, terminal: TERMINAL });
});

it('url·title 은 2000자·300자로 자른다', async () => {
    writeMeta({ ...META, url: 'u'.repeat(5000), title: 't'.repeat(1000) });
    const r = await readLiveView(dir);
    expect(r.browser?.url).toHaveLength(2000);
    expect(r.browser?.title).toHaveLength(300);
    expect(r.browser?.image).toBeNull();
});

it('이미지가 FRAME_MAX_BYTES 를 넘으면 image 만 null', async () => {
    writeFileSync(join(dir, LIVE_VIEW.FRAME_FILE), Buffer.alloc(LIVE_VIEW.FRAME_MAX_BYTES + 1));
    writeMeta(META);
    expect(await readLiveView(dir)).toEqual({ browser: { image: null, ...META }, terminal: null });
});

it('.live-frame.jpg 가 작업 폴더 밖을 가리키는 심링크면 image 는 null', async () => {
    const secret = join(outside, 'secret.jpg');
    writeFileSync(secret, 'host secret');
    symlinkSync(secret, join(dir, LIVE_VIEW.FRAME_FILE));
    writeMeta(META);
    expect((await readLiveView(dir)).browser).toEqual({ image: null, ...META });
});

it('meta·terminal 이 밖을 가리키는 심링크면 null', async () => {
    writeFileSync(join(outside, 'm.json'), JSON.stringify(META));
    writeFileSync(join(outside, 't.json'), JSON.stringify(TERMINAL));
    symlinkSync(join(outside, 'm.json'), join(dir, LIVE_VIEW.META_FILE));
    symlinkSync(join(outside, 't.json'), join(dir, LIVE_VIEW.TERMINAL_FILE));
    expect(await readLiveView(dir)).toEqual({ browser: null, terminal: null });
});

it('깨진 JSON 은 null', async () => {
    writeFileSync(join(dir, LIVE_VIEW.FRAME_FILE), Buffer.from([0xff, 0xd8]));
    writeFileSync(join(dir, LIVE_VIEW.META_FILE), '{"url":');
    writeFileSync(join(dir, LIVE_VIEW.TERMINAL_FILE), 'not json');
    expect(await readLiveView(dir)).toEqual({ browser: null, terminal: null });
});

it('필드 타입이 틀리면 그 부분은 null', async () => {
    writeMeta({ url: 1, title: 't', at: 1 });
    writeFileSync(join(dir, LIVE_VIEW.TERMINAL_FILE), JSON.stringify({ ...TERMINAL, exitCode: 'x' }));
    expect(await readLiveView(dir)).toEqual({ browser: null, terminal: null });
});

it('숨김 파일이 폴더면 null', async () => {
    mkdirSync(join(dir, LIVE_VIEW.TERMINAL_FILE));
    expect((await readLiveView(dir)).terminal).toBeNull();
});

it('숨김 파일이 FIFO 여도 기다리지 않고 null', async () => {
    execFileSync('mkfifo', [join(dir, LIVE_VIEW.TERMINAL_FILE)]);
    expect((await readLiveView(dir)).terminal).toBeNull();
});

it('terminal output 은 TERMINAL_TAIL_CHARS 로 자른다', async () => {
    const output = 'x'.repeat(LIVE_VIEW.TERMINAL_TAIL_CHARS) + 'END';
    writeFileSync(join(dir, LIVE_VIEW.TERMINAL_FILE), JSON.stringify({ ...TERMINAL, output, endedAt: null, exitCode: null }));
    const t = (await readLiveView(dir)).terminal!;
    expect(t.output).toHaveLength(LIVE_VIEW.TERMINAL_TAIL_CHARS);
    expect(t.output.endsWith('END')).toBe(true);
    expect(t.truncatedHead).toBe(true);
    expect(t.endedAt).toBeNull();
});

it('terminal command 는 앞 2000자만 남긴다', async () => {
    writeFileSync(join(dir, LIVE_VIEW.TERMINAL_FILE), JSON.stringify({ ...TERMINAL, command: 'c'.repeat(2500) }));
    expect((await readLiveView(dir)).terminal?.command).toBe('c'.repeat(2000));
});

describe('frameAt — 같은 화면은 이미지를 다시 보내지 않는다', () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]);
    beforeEach(() => { writeFileSync(join(dir, LIVE_VIEW.FRAME_FILE), jpg); writeMeta(META); });
    it('frameAt 이 meta.at 과 같으면 image null · unchanged true', async () => {
        expect((await readLiveView(dir, { frameAt: META.at })).browser).toEqual({ image: null, unchanged: true, ...META });
    });
    it('frameAt 이 다르면 image 를 보낸다(unchanged 필드 없음)', async () => {
        expect((await readLiveView(dir, { frameAt: META.at - 1 })).browser).toEqual({ image: jpg.toString('base64'), ...META });
    });
});
