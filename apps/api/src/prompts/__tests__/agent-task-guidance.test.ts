/**
 * 작업환경 안내 — 실행기별 분기 회귀 테스트.
 *
 * 로컬 실행기 작업에 컨테이너 안내(/workspace·브라우저·번들 도구)가 들어가 모델이 `cd /workspace` 로
 * 턴을 버렸다(2026-09-15 CLI 라이브 실측). 로컬 안내는 연결 폴더 기준이어야 하고, 샌드박스 안내는 그대로다.
 */
import { getTaskSandboxGuidance, getLocalExecutorGuidance, getAgentTaskUploadedFilesNote } from '../agent-task-prompt';

describe('작업환경 안내 — 실행기별', () => {
    it('로컬 안내는 연결 폴더 기준 상대경로를 안내하고 컨테이너 전제를 담지 않는다', () => {
        const local = getLocalExecutorGuidance();
        expect(local).toContain('사용자가 연결한 로컬 폴더가 작업 디렉토리');
        expect(local).toContain('상대경로');
        expect(local).not.toContain('작업 디렉토리 /workspace');
        expect(local).not.toContain('browser 도구로 웹을 탐색');
        expect(local).not.toContain('kordoc');
        expect(local).not.toContain('/usr/share/fonts');
    });

    it('샌드박스 안내는 컨테이너 작업환경(/workspace·브라우저)을 그대로 안내한다', () => {
        const sandbox = getTaskSandboxGuidance();
        expect(sandbox).toContain('작업 디렉토리 /workspace');
        expect(sandbox).toContain('browser 도구로 웹을 탐색');
    });

    it('코드 탐색·승인·계획 추적 안내는 두 실행기에 같은 문구로 들어간다', () => {
        for (const guidance of [getTaskSandboxGuidance(), getLocalExecutorGuidance()]) {
            expect(guidance).toContain('grep_code(정규식 → 파일:줄)');
            expect(guidance).toContain('## 계획 추적 (G3)');
            expect(guidance).toContain('terminate(또는 ask_human)');
        }
    });

    it('첨부 파일 안내는 실행기 중립이다 (컨테이너 경로를 전제하지 않는다)', () => {
        expect(getAgentTaskUploadedFilesNote(['- uploads/a.txt'])).not.toContain('/workspace');
    });
});
