/**
 * file_ops 목록 규약 테스트 — 하위 폴더 인지 개선 (2026-07-26 보고 대응).
 *
 * 증상: 작업 폴더에 하위 폴더가 있으면 관련 파일을 못 읽었다.
 * 원인: `list` 가 이름만 반환해(디렉토리 표시 없음) 모델이 폴더를 파일로 오인해
 *       read 하다 EISDIR 로 실패하고, 재귀 목록은 도구로 노출되지 않았다.
 */
import { createTaskTools } from '../tools';
import type { TaskExecutor } from '../executor';

function makeSandbox(over: Partial<TaskExecutor> = {}): TaskExecutor {
    return {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        listDir: jest.fn().mockResolvedValue([]),
        listWorkspaceFiles: jest.fn().mockResolvedValue([]),
        deleteFile: jest.fn(),
        exec: jest.fn(),
        cleanup: jest.fn(),
        ...over,
    } as unknown as TaskExecutor;
}

function fileOps(sandbox: TaskExecutor) {
    const t = createTaskTools(sandbox).find((x) => x.tool.name === 'file_ops');
    if (!t) throw new Error('file_ops 도구를 찾지 못함');
    return t;
}

describe('file_ops 목록 규약', () => {
    it('list 는 실행기가 준 표기를 그대로 전달한다 (폴더는 "/" 접미사)', async () => {
        const sandbox = makeSandbox({
            listDir: jest.fn().mockResolvedValue(['docs/', 'images/', 'root.txt']),
        });
        const r = await fileOps(sandbox).handler({ op: 'list' });
        const text = (r.content?.[0] as { text?: string })?.text ?? '';
        expect(text).toContain('docs/');
        expect(text).toContain('root.txt');
    });

    it('tree 는 하위 폴더까지 재귀 목록을 반환한다', async () => {
        const sandbox = makeSandbox({
            listWorkspaceFiles: jest.fn().mockResolvedValue([
                'docs/guide.md', 'docs/sub/deep.txt', 'images/logo.png', 'root.txt',
            ]),
        });
        const r = await fileOps(sandbox).handler({ op: 'tree' });
        const text = (r.content?.[0] as { text?: string })?.text ?? '';
        expect(text).toContain('docs/sub/deep.txt');
        expect(text.split('\n')).toHaveLength(4);
    });

    it('tree 결과가 비면 안내 문구를 준다', async () => {
        const r = await fileOps(makeSandbox()).handler({ op: 'tree' });
        expect((r.content?.[0] as { text?: string })?.text).toContain('빈 workspace');
    });

    it('tree 가 상한에 걸리면 잘렸음을 명시한다 (조용한 truncation 금지)', async () => {
        const many = Array.from({ length: 1000 }, (_, i) => `f${i}.txt`);
        const sandbox = makeSandbox({ listWorkspaceFiles: jest.fn().mockResolvedValue(many) });
        const r = await fileOps(sandbox).handler({ op: 'tree' });
        expect((r.content?.[0] as { text?: string })?.text).toContain('잘렸습니다');
    });

    it('도구 설명에 tree 와 폴더 표기 규약이 안내된다 (모델이 알아야 씀)', () => {
        const desc = fileOps(makeSandbox()).tool.description ?? '';
        expect(desc).toContain('tree');
        expect(desc).toContain('"/"');
    });
});
