/**
 * 작업 공간 스냅숏 복원 컨테이너의 인자 — 권한 제한·마운트·ref 검증.
 */
import { buildSnapshotRestoreArgs } from './snapshot-restore';
import { getTaskSandboxConfig } from '../../config/task-sandbox';

const cfg = getTaskSandboxConfig();

describe('buildSnapshotRestoreArgs', () => {
    const args = buildSnapshotRestoreArgs('/tmp/ws/src', '/tmp/ws/new', 'refs/omk/turn-2', cfg);
    const joined = args.join(' ');

    it('일회성(--rm)이고 네트워크·권한은 메인 샌드박스와 같은 수준으로 잠근다', () => {
        expect(args.slice(0, 2)).toEqual(['run', '--rm']);
        expect(joined).toContain('--network none');
        expect(joined).toContain('--cap-drop ALL');
        expect(joined).toContain('--security-opt no-new-privileges');
        expect(joined).toContain('--read-only');
        expect(joined).toContain(`--user ${cfg.user}`);
    });
    it('원 작업 공간은 읽기 전용으로, 새 작업 공간만 쓰기로 붙인다', () => {
        expect(joined).toContain('-v /tmp/ws/src:/src:ro');
        expect(joined).toContain('-v /tmp/ws/new:/workspace:rw');
    });
    it('지정한 ref 를 풀어 새 작업 공간에 쓴다', () => {
        const script = args[args.length - 1];
        expect(script).toContain('archive');
        expect(script).toContain('refs/omk/turn-2');
        expect(script).toContain('tar -xf');
    });
    it('ref 이름에 셸 문자가 섞이면 거절한다', () => {
        expect(() => buildSnapshotRestoreArgs('/a', '/b', 'refs/omk/x; rm -rf /', cfg)).toThrow();
    });
});
