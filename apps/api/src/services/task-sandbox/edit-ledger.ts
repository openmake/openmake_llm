/**
 * 파일 편집 해시 장부 (하네스 P2-6) — 편집의 비교 후 교체(compare-and-swap).
 *
 * 작업 도구 세트(createTaskTools 한 벌 = 작업 하나·서브에이전트 하나)가 마지막으로 **본** 파일 내용과 마지막으로 **쓴**
 * 내용의 sha256 을 경로별로 기억한다. 편집 직전에 읽은 실제 내용이 기억한 해시와 다르면, 이 도구 세트가 모르는 사이에
 * 파일이 바뀐 것이다(로컬 실행기에서 사용자가 고침·같은 workspace 의 다른 서브에이전트가 씀). 이때 편집을 반영하지 않고
 * 다시 보라고 돌려준다 — 종전엔 마지막 쓰기가 이겨 그 변경이 조용히 사라졌다.
 *
 * 기억이 없는 경로(처음 만지는 파일)는 막지 않는다. bash 는 자기 명령이 파일을 바꿀 수 있어 실행할 때마다 장부를 비운다
 * (자기 포매터·sed 결과를 "남의 변경" 으로 오판하지 않게 — 턴 수가 곧 비용이다).
 * 한계: 읽기와 쓰기 사이의 짧은 틈은 실행기가 원자적 조건부 쓰기를 제공하지 않아 막지 못한다.
 *
 * AGENT_TASK_EDIT_CAS(기본 OFF)일 때만 판정한다 — 꺼져 있으면 모든 호출이 통과하고 기록도 하지 않는다.
 *
 * @module services/task-sandbox/edit-ledger
 */
import { createHash } from 'crypto';
import { posix } from 'path';
import { stripWorkspacePrefix } from './workspace-path';

export type EditCheck = { ok: true } | { ok: false; deleted: boolean };

function sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** 같은 파일의 다른 표기(`./a`, `/workspace/a`, `a//b`)를 한 키로. */
export function ledgerKey(path: string): string {
    return posix.normalize(stripWorkspacePrefix(path)).replace(/^\.\//, '');
}

export class EditLedger {
    private readonly seen = new Map<string, string>();

    constructor(private readonly enabled: boolean) {}

    /** 이 도구 세트가 path 의 이 내용을 보았거나 썼다. */
    observe(path: string, content: string): void {
        if (this.enabled) this.seen.set(ledgerKey(path), sha256(content));
    }

    /** 편집 직전 판정 — current 는 지금 읽은 내용(없으면 null). */
    check(path: string, current: string | null): EditCheck {
        if (!this.enabled) return { ok: true };
        const known = this.seen.get(ledgerKey(path));
        if (known === undefined) return { ok: true };
        if (current === null) return { ok: false, deleted: true };
        return sha256(current) === known ? { ok: true } : { ok: false, deleted: false };
    }

    forget(path: string): void { this.seen.delete(ledgerKey(path)); }

    /** 셸 명령처럼 무엇을 바꿨는지 모르는 실행 뒤 — 전부 잊는다. */
    clear(): void { this.seen.clear(); }
}
