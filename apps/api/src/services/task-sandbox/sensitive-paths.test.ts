/**
 * 민감 파일 판정 + 쓰기 승인 상향 (2026-09-06).
 *
 * 고정하는 계약:
 *  - 판정은 파일명(basename) 기준이고 디렉토리 위치와 무관하다.
 *  - high-risk 정책에서 자격증명 파일을 **쓰는** 호출만 승인 대상이 된다(읽기·목록은 아님).
 *  - all/none 정책의 의미는 바뀌지 않는다.
 */
import { isSensitivePath } from './sensitive-paths';
import { isSensitiveWrite, requiresApproval, stripApprovalGatedTools } from './approval-gate';

describe('isSensitivePath', () => {
    it('자격증명 파일을 경로 위치와 무관하게 잡는다', () => {
        for (const p of ['.env', 'apps/api/.env', './.env.production', 'certs/server.pem', 'a/b/app.key',
            'id_rsa', 'deploy/id_ed25519', '.npmrc', '.pgpass', 'credentials', 'gcp/service-account-prod.json']) {
            expect(isSensitivePath(p)).toBe(true);
        }
    });

    it('일반 소스·문서는 잡지 않는다', () => {
        for (const p of ['src/env.ts', 'README.md', 'docs/environment.md', 'package.json', 'src/keychain/index.ts']) {
            expect(isSensitivePath(p)).toBe(false);
        }
    });

    it('문자열이 아니거나 빈 경로는 false (판정 불가를 차단 사유로 쓰지 않는다)', () => {
        expect(isSensitivePath(undefined)).toBe(false);
        expect(isSensitivePath(123)).toBe(false);
        expect(isSensitivePath('')).toBe(false);
        expect(isSensitivePath('/')).toBe(false);
    });
});

describe('isSensitiveWrite', () => {
    it('file_ops 는 write·delete 만, str_replace_editor 는 편집 명령만 해당', () => {
        expect(isSensitiveWrite('file_ops', { op: 'write', path: '.env' })).toBe(true);
        expect(isSensitiveWrite('file_ops', { op: 'delete', path: 'certs/a.pem' })).toBe(true);
        expect(isSensitiveWrite('file_ops', { op: 'read', path: '.env' })).toBe(false);
        expect(isSensitiveWrite('file_ops', { op: 'list', path: '.' })).toBe(false);
        expect(isSensitiveWrite('str_replace_editor', { command: 'create', path: '.env.local' })).toBe(true);
        expect(isSensitiveWrite('str_replace_editor', { command: 'str_replace', path: 'app.key' })).toBe(true);
        expect(isSensitiveWrite('str_replace_editor', { command: 'view', path: '.env' })).toBe(false);
        expect(isSensitiveWrite('bash', { command: 'cat .env' })).toBe(false);   // 셸은 별도 게이트
    });

    it('인자 미지({})는 false — 강등 계산의 보수 판정 계약과 같다', () => {
        expect(isSensitiveWrite('file_ops', {})).toBe(false);
        expect(isSensitiveWrite('str_replace_editor', {})).toBe(false);
    });
});

describe('requiresApproval — 민감 파일 쓰기 상향', () => {
    it('high-risk: 자격증명 쓰기는 승인 대상, 일반 파일 쓰기는 아니다', () => {
        expect(requiresApproval('high-risk', 'file_ops', { op: 'write', path: '.env' })).toBe(true);
        expect(requiresApproval('high-risk', 'file_ops', { op: 'write', path: 'src/a.ts' })).toBe(false);
        expect(requiresApproval('high-risk', 'str_replace_editor', { command: 'create', path: 'certs/server.pem' })).toBe(true);
        expect(requiresApproval('high-risk', 'str_replace_editor', { command: 'create', path: 'src/a.ts' })).toBe(false);
    });

    it('high-risk: 자격증명 읽기·탐색은 종전대로 승인 불요', () => {
        expect(requiresApproval('high-risk', 'file_ops', { op: 'read', path: '.env' })).toBe(false);
        expect(requiresApproval('high-risk', 'grep_code', { pattern: 'API_KEY' })).toBe(false);
        expect(requiresApproval('high-risk', 'repo_map', {})).toBe(false);
    });

    it('none 은 무엇도 승인하지 않고, all 은 종전대로 전부 승인한다(정책 의미 불변)', () => {
        expect(requiresApproval('none', 'file_ops', { op: 'write', path: '.env' })).toBe(false);
        expect(requiresApproval('all', 'file_ops', { op: 'write', path: 'src/a.ts' })).toBe(true);
        expect(requiresApproval('all', 'grep_code', { pattern: 'x' })).toBe(true);
    });

    it('로컬 브리지의 셸 위임(deviceGatesShell)은 영향을 받지 않는다', () => {
        expect(requiresApproval('high-risk', 'bash', { command: 'echo hi' }, { deviceGatesShell: true })).toBe(false);
    });
});

describe('stripApprovalGatedTools — 인자 미지 보수 판정', () => {
    it('high-risk 에서 파일 도구는 남는다(민감 여부는 호출 시점에 판정)', () => {
        const tools = [
            { function: { name: 'file_ops' } },
            { function: { name: 'str_replace_editor' } },
            { function: { name: 'bash' } },
            { function: { name: 'grep_code' } },
        ];
        const names = stripApprovalGatedTools(tools, 'high-risk').map((t) => t.function.name);
        expect(names).toEqual(['file_ops', 'str_replace_editor', 'grep_code']);
    });
});
