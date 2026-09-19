/**
 * 로컬 디렉터리 설치 소스 (2026-09-19, S3 에어갭) — 루트 고정·심링크 탈출 차단·상한.
 *
 * ⚠️ 이 페처는 서버 파일시스템을 읽는다. 아래 판정이 깨지면 임의 경로 읽기가 열린다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    LocalDirectoryFetcher, isLocalSourceUrl, localPseudoRepo, resolveLocalSourceDir,
} from '../local-directory-fetcher';

let root: string;
let outside: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-local-root-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-local-out-'));
    fs.mkdirSync(path.join(root, 'pack'));
    fs.writeFileSync(path.join(root, 'pack', 'plugin.json'), '{"name":"p","version":"1.0.0"}');
    fs.mkdirSync(path.join(root, 'pack', 'skills'));
    fs.writeFileSync(path.join(root, 'pack', 'skills', 'a.md'), '# skill a');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP SECRET');
});

const limits = () => ({ root, maxEntries: 100, maxTotalBytes: 1_000_000 });

describe('local:// 소스 판정', () => {
    it('접두로 구분하고 pseudo repo 를 만든다', () => {
        expect(isLocalSourceUrl('local://pack')).toBe(true);
        expect(isLocalSourceUrl('https://github.com/a/b')).toBe(false);
        expect(localPseudoRepo('local://pack')).toEqual({ owner: 'local', repo: 'pack' });
    });
});

describe('resolveLocalSourceDir — 루트 밖을 절대 허용하지 않는다', () => {
    it('루트 안 디렉터리는 실제 경로를 돌려준다', () => {
        expect(resolveLocalSourceDir('local://pack', root)).toBe(fs.realpathSync(path.join(root, 'pack')));
    });

    it('.. 로 루트를 벗어나면 거절', () => {
        expect(() => resolveLocalSourceDir('local://../..', root)).toThrow(/OUT_OF_ROOT|NOT_FOUND/);
    });

    it('심링크로 루트를 벗어나면 거절 (어휘적 resolve 로는 못 막는다)', () => {
        fs.symlinkSync(outside, path.join(root, 'escape'));
        expect(() => resolveLocalSourceDir('local://escape', root)).toThrow(/OUT_OF_ROOT/);
    });

    it('루트 미설정이면 기능 자체가 꺼져 있다', () => {
        expect(() => resolveLocalSourceDir('local://pack', '')).toThrow(/LOCAL_SOURCE_DISABLED/);
    });

    it('파일을 가리키면 거절', () => {
        expect(() => resolveLocalSourceDir('local://pack/plugin.json', root)).toThrow(/NOT_DIR/);
    });
});

describe('LocalDirectoryFetcher — GitFetcher 동형', () => {
    it('트리와 파일을 읽고, 같은 내용이면 같은 sha 를 준다', async () => {
        const f = new LocalDirectoryFetcher('local://pack', limits());
        const sha = await f.resolveRef('local', 'pack');
        const tree = await f.listTree('local', 'pack', sha);

        expect(tree.entries.map(e => e.path).sort()).toEqual(['plugin.json', 'skills/a.md']);
        expect(await f.fetchFile('local', 'pack', sha, 'skills/a.md')).toBe('# skill a');

        const again = await new LocalDirectoryFetcher('local://pack', limits()).resolveRef('local', 'pack');
        expect(again).toBe(sha);
    });

    it('내용이 바뀌면 sha 가 바뀐다(업데이트 판정 기준)', async () => {
        const before = await new LocalDirectoryFetcher('local://pack', limits()).resolveRef('local', 'pack');
        fs.writeFileSync(path.join(root, 'pack', 'skills', 'a.md'), '# skill a (v2)');
        const after = await new LocalDirectoryFetcher('local://pack', limits()).resolveRef('local', 'pack');
        expect(after).not.toBe(before);
    });

    it('트리 안의 심링크는 따라가지 않는다', async () => {
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'pack', 'leak.txt'));
        const f = new LocalDirectoryFetcher('local://pack', limits());
        const tree = await f.listTree('local', 'pack', await f.resolveRef('local', 'pack'));
        expect(tree.entries.map(e => e.path)).not.toContain('leak.txt');
    });

    it('총 크기 상한을 넘으면 거절', async () => {
        fs.writeFileSync(path.join(root, 'pack', 'big.bin'), Buffer.alloc(2048));
        const f = new LocalDirectoryFetcher('local://pack', { root, maxEntries: 100, maxTotalBytes: 1024 });
        await expect(f.resolveRef('local', 'pack')).rejects.toThrow(/TOO_LARGE/);
    });

    it('빈 디렉터리는 거절', async () => {
        fs.mkdirSync(path.join(root, 'empty'));
        const f = new LocalDirectoryFetcher('local://empty', limits());
        await expect(f.resolveRef('local', 'empty')).rejects.toThrow(/EMPTY/);
    });
});
