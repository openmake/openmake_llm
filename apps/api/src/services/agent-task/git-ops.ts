/**
 * Agent Task Git 통합 (Phase 2) — 호스트측 git 연산.
 *
 * 보안 아키텍처: clone/push/PR 은 **호스트(API 프로세스)에서만** 수행하고 격리 컨테이너에는
 * 토큰·네트워크를 절대 넣지 않는다. 토큰은 clone URL(execFile args — shell 미경유)에만 순간
 * 존재하고 즉시 remote set-url 로 제거 → 컨테이너가 보게 될 .git/config 에 토큰이 남지 않는다.
 * 컨테이너는 --network none 이라 인젝션이 있어도 유출 대상/경로가 없다.
 *
 * @module services/agent-task/git-ops
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getUserGithubToken } from '../github-token';
import { getAgentTaskGitRepoGuidance } from '../../prompts/agent-task-prompt';
import { createLogger } from '../../utils/logger';

const execFileAsync = promisify(execFile);
const logger = createLogger('AgentTaskGitOps');

const GIT_CLONE_TIMEOUT_MS = 120_000;
const GIT_CMD_TIMEOUT_MS = 20_000;

export interface RepoRef {
    owner: string;
    repo: string;
    /** 토큰 없는 정규 URL (컨테이너 .git/config·로그 노출용). */
    cleanUrl: string;
}

/** repoUrl 파싱 — https://github.com/owner/repo(.git) 만 허용(ssh·타 호스트 거절). 아니면 null. */
export function parseGithubRepo(repoUrl: string): RepoRef | null {
    const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec((repoUrl || '').trim());
    if (!m) return null;
    const owner = m[1];
    const repo = m[2];
    return { owner, repo, cleanUrl: `https://github.com/${owner}/${repo}` };
}

/** 에러 메시지에서 토큰 흔적 제거 — git stderr 에 auth URL 이 실릴 가능성 차단. */
function scrub(msg: string, token: string | null): string {
    let s = msg;
    if (token) s = s.split(token).join('***');
    return s.replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@');
}

/**
 * 호스트에서 repo 를 workspace(빈 디렉토리)에 clone 하고 remote 에서 토큰을 제거한다.
 * token 이 있으면 인증 clone, 없으면 익명(public repo). 성공 시 RepoRef, 실패 시 null(fail-open).
 * 호출부(AgentTaskService)는 create() 직후·입력첨부/baseline 이전에 호출한다(빈 workspace 전제).
 */
export async function cloneRepoToWorkspace(
    hostWorkdir: string,
    repoUrl: string,
    branch: string | undefined,
    token: string | null,
): Promise<RepoRef | null> {
    const ref = parseGithubRepo(repoUrl);
    if (!ref) { logger.warn(`지원하지 않는 repo URL(https://github.com/owner/repo 만): ${repoUrl}`); return null; }
    const authUrl = token
        ? `https://x-access-token:${token}@github.com/${ref.owner}/${ref.repo}`
        : ref.cleanUrl;
    try {
        const args = ['clone', '--depth', '50'];
        if (branch) args.push('--branch', branch);
        args.push(authUrl, hostWorkdir);
        await execFileAsync('git', args, { timeout: GIT_CLONE_TIMEOUT_MS });
        // 토큰 제거 — 컨테이너가 보게 될 .git/config 에 토큰이 남지 않게 즉시 정규 URL 로 재설정.
        await execFileAsync('git', ['-C', hostWorkdir, 'remote', 'set-url', 'origin', ref.cleanUrl], { timeout: GIT_CMD_TIMEOUT_MS });
        logger.info(`clone 완료: ${ref.owner}/${ref.repo}${branch ? `@${branch}` : ''} → workspace`);
        return ref;
    } catch (e) {
        logger.warn(`clone 실패 ${ref.owner}/${ref.repo}: ${scrub(e instanceof Error ? e.message : String(e), token)}`);
        return null;
    }
}

/**
 * 태스크 실행 시작 시 repo clone + 에이전트 안내 주입(AgentTaskService 배선 최소화용 헬퍼).
 * gitRepoUrl 이 없으면 no-op. 토큰은 사용자 github 연결에서 조회(호스트 전용). clone 성공 &&
 * 신규 실행(resume 아님)이면 system 프롬프트에 repo 작업 안내를 덧붙인다.
 */
export async function setupTaskRepo(
    runtime: { workspacePath: string },
    input: { gitRepoUrl?: string; gitBranch?: string; resume?: unknown },
    userId: string,
    conversation: { role: string; content: string }[],
): Promise<void> {
    if (!input.gitRepoUrl) return;
    const token = await getUserGithubToken(userId);
    const ref = await cloneRepoToWorkspace(runtime.workspacePath, input.gitRepoUrl, input.gitBranch, token);
    if (ref && !input.resume && conversation[0]?.role === 'system') {
        conversation[0].content += getAgentTaskGitRepoGuidance(ref, input.gitBranch);
    }
}
