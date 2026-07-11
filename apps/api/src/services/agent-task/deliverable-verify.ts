/**
 * Agent Task 산출물 실행 검증 (Phase 2-B) — quality.
 *
 * 코드 deliverable(<artifact kind="code" lang="...">)을 완료 처리 전에 샌드박스에서 1회
 * **문법/컴파일 검사**해 명백한 오류를 잡는다. 실측 근거: 실행 grounding 은 self-critique 보다
 * 값싸고 정확하다(틀린 코드를 "PASS"로 통과시키는 자기평가의 맹점을 실제 컴파일러가 막는다).
 *
 * 코드를 **실행하지 않고 컴파일/문법만** 검사한다(py_compile · node --check) — 부작용·hang 없음.
 * 검사 불가 언어(ts/html/sql 등)나 코드가 아닌 산출물은 통과(ok=true)로 취급. 검사 자체 실패는
 * fail-open(ok=true) — 검증 인프라 문제로 정상 산출물을 막지 않는다.
 *
 * @module services/agent-task/deliverable-verify
 */
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { ExtractedArtifact } from '../../llm/artifact-parser';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskVerify');

/** 언어별 문법/컴파일 검사 — 파일 확장자 + 검사 명령. 코드를 실행하지 않는 것만 등록. */
interface LangCheck { ext: string; cmd: (file: string) => string; }
const LANG_CHECKS: Record<string, LangCheck> = {
    python: { ext: 'py', cmd: (f) => `python3 -m py_compile ${f}` },
    python3: { ext: 'py', cmd: (f) => `python3 -m py_compile ${f}` },
    py: { ext: 'py', cmd: (f) => `python3 -m py_compile ${f}` },
    javascript: { ext: 'js', cmd: (f) => `node --check ${f}` },
    js: { ext: 'js', cmd: (f) => `node --check ${f}` },
    node: { ext: 'js', cmd: (f) => `node --check ${f}` },
    mjs: { ext: 'mjs', cmd: (f) => `node --check ${f}` },
    cjs: { ext: 'cjs', cmd: (f) => `node --check ${f}` },
};

export interface VerifyResult {
    /** 모든 검사 대상이 통과했거나 검사 대상이 없으면 true. */
    ok: boolean;
    /** 실패 시 LLM 에 전달할 오류 리포트(언어·제목·stderr). ok=true 면 빈 문자열. */
    report: string;
}

const MAX_REPORT_CHARS = 2000;

/**
 * 코드 산출물을 샌드박스에서 문법/컴파일 검사. 절대 throw 하지 않음(fail-open).
 */
export async function verifyCodeArtifacts(
    runtime: TaskRuntime,
    artifacts: ExtractedArtifact[],
    signal?: AbortSignal,
): Promise<VerifyResult> {
    try {
        if (signal?.aborted) return { ok: true, report: '' };
        // kind='code' 이고 검사 가능한 언어인 산출물만.
        const targets = artifacts
            .map((a, i) => ({ a, i, check: a.kind === 'code' && a.lang ? LANG_CHECKS[a.lang.toLowerCase()] : undefined }))
            .filter((x): x is { a: ExtractedArtifact; i: number; check: LangCheck } => !!x.check);
        if (targets.length === 0) return { ok: true, report: '' };

        const failures: string[] = [];
        for (const { a, i, check } of targets) {
            if (signal?.aborted) break;
            const file = `.verify_${i}.${check.ext}`;
            try {
                await runtime.writeWorkspaceFile(file, a.content ?? '');
                const r = await runtime.execRaw(check.cmd(file));
                if (r.exitCode !== 0 || r.timedOut) {
                    const err = (r.stderr || r.stdout || '(no output)').trim().slice(0, MAX_REPORT_CHARS);
                    failures.push(`### ${a.title || a.id} (${a.lang})\n${err}`);
                    logger.info(`[Verify] 산출물 문법 검사 실패: ${a.id} (${a.lang})`);
                }
            } catch (e) {
                // 개별 산출물 검사 실패는 통과 취급(fail-open) — 인프라 문제로 완료를 막지 않음.
                logger.debug(`[Verify] 검사 스킵(${a.id}): ${e instanceof Error ? e.message : e}`);
            }
        }
        if (failures.length === 0) return { ok: true, report: '' };
        return { ok: false, report: failures.join('\n\n').slice(0, MAX_REPORT_CHARS) };
    } catch (e) {
        logger.warn(`[Verify] 검증 전체 실패 — fail-open: ${e instanceof Error ? e.message : e}`);
        return { ok: true, report: '' };
    }
}
