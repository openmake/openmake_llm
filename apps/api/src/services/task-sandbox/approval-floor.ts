/**
 * 자동승인의 바닥 — PURE.
 *
 * 작업의 "나머지 모두 승인"은 질문 도구만 빼고 전부 통과시켰다. 자격증명 파일 쓰기, 에이전트 지시 파일 쓰기, 외부 MCP 도구, 사용자 메모리 쓰기처럼
 * 한 번의 통과가 되돌리기 어려운 호출은 전체 허용에서도 계속 묻는다. 어떤 종류를 바닥으로 둘지는
 * `config/agent-task-approval` 의 APPROVAL_FLOOR.
 *
 * ⚠️ 휴리스틱이다. 파일 도구의 대상 경로만 본다 — 셸(bash·python_execute)로 같은 파일을 쓰는 것은 여기서 걸리지 않는다.
 * 경로는 표기만 정리한다(`..`·`.`·겹친 구분자·역슬래시·끝의 점과 공백). 파일 시스템을 보지 않으므로 심볼릭 링크는 풀지 못한다.
 *
 * @module services/task-sandbox/approval-floor
 */
import { APPROVAL_FLOOR, INSTRUCTION_FILE_PATTERNS, type ApprovalFloorKind } from '../../config/agent-task-approval';
import { isThirdPartyTool } from '../../config/tool-policy';
import { MEMORY_SAVE_TOOL_NAME } from '../../config/agent-task-skill-memory';
import { isSensitivePath } from './sensitive-paths';
import { hasOffListSiteWrites, hasSiteUploads } from './browser-site-approval';

/** 파일을 바꾸는 작업 — 도구별 인자 이름과 값. */
const FILE_WRITE_OPS = new Set(['write', 'delete']);
const EDITOR_WRITE_COMMANDS = new Set(['create', 'str_replace', 'insert']);

/**
 * PURE: 경로 표기를 구간 배열로 정리한다 — 같은 파일을 가리키는 다른 표기가 이름 비교를 비켜 가지 못하게.
 * 역슬래시는 구분자로, 빈 구간·`.` 은 버리고, `..` 은 앞 구간을 지운다(더 지울 것이 없으면 남긴다).
 * 구간 끝의 점·공백은 뗀다(Windows 는 `AGENTS.md.` 와 `AGENTS.md ` 를 `AGENTS.md` 로 연다).
 */
export function normalizeToolPath(path: string): string[] {
    const out: string[] = [];
    for (const raw of path.replace(/\\/g, '/').split('/')) {
        if (raw === '' || raw === '.') continue;
        if (raw === '..') {
            if (out.length > 0 && out[out.length - 1] !== '..') out.pop(); else out.push('..');
            continue;
        }
        const seg = raw.replace(/[\s.]+$/, '');
        if (seg) out.push(seg);
    }
    return out;
}

/** PURE: 파일을 바꾸는 호출이면 정리한 대상 경로(`/` 로 이은 구간). 읽기·다른 도구·경로 없음은 null. */
export function writeTargetPath(toolName: string, args: Record<string, unknown>): string | null {
    const writes = toolName === 'file_ops' ? FILE_WRITE_OPS.has(String(args.op))
        : toolName === 'str_replace_editor' ? EDITOR_WRITE_COMMANDS.has(String(args.command))
            : false;
    if (!writes || typeof args.path !== 'string') return null;
    const segments = normalizeToolPath(args.path);
    return segments.length > 0 && segments[segments.length - 1] !== '..' ? segments.join('/') : null;
}

/** 구간 글롭 → 정규식(대소문자 무시). */
function segmentRegExp(glob: string): RegExp {
    let out = '';
    for (const c of glob) out += c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${out}$`, 'i');
}

const DIR_SUFFIX = '/**';
const INSTRUCTION_RULES = INSTRUCTION_FILE_PATTERNS.map((p) => {
    const under = p.endsWith(DIR_SUFFIX);
    return { under, segs: (under ? p.slice(0, -DIR_SUFFIX.length) : p).split('/').filter(Boolean).map(segmentRegExp) };
}).filter((r) => r.segs.length > 0);

/** PURE: 정리한 경로가 에이전트 지시 파일을 가리키는가. */
export function isInstructionPath(normalizedPath: string): boolean {
    const segs = normalizedPath.split('/');
    const matchAt = (rule: RegExp[], start: number): boolean => rule.every((re, i) => re.test(segs[start + i] ?? ''));
    return INSTRUCTION_RULES.some((r) => {
        if (!r.under) return segs.length >= r.segs.length && matchAt(r.segs, segs.length - r.segs.length);
        // 디렉토리 아래 전부 — 그 디렉토리 구간이 어디에 있든, 뒤에 구간이 하나 이상 남아야 한다
        for (let i = 0; i + r.segs.length < segs.length; i++) if (matchAt(r.segs, i)) return true;
        return false;
    });
}

/** PURE: 이 호출이 자동승인에서도 물어야 하는 바닥 호출이면 그 종류, 아니면 null. */
export function approvalFloorReason(toolName: string, args: Record<string, unknown>): ApprovalFloorKind | null {
    if (hasSiteUploads(toolName, args)) return 'site_upload'; // 고를 수 없는 바닥 — APPROVAL_FLOOR 와 무관
    if (APPROVAL_FLOOR.has('third_party_tool') && isThirdPartyTool(toolName)) return 'third_party_tool';
    if (APPROVAL_FLOOR.has('memory_write') && toolName === MEMORY_SAVE_TOOL_NAME) return 'memory_write';
    if (APPROVAL_FLOOR.has('site_write') && hasOffListSiteWrites(toolName, args)) return 'site_write';
    const target = writeTargetPath(toolName, args);
    if (target === null) return null;
    if (APPROVAL_FLOOR.has('credential_write') && isSensitivePath(target)) return 'credential_write';
    if (APPROVAL_FLOOR.has('instruction_write') && isInstructionPath(target)) return 'instruction_write';
    return null;
}
