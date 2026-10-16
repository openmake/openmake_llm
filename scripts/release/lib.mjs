/**
 * 릴리스 후보 검증의 순수 함수 — commands.json 검증, 출력에서 통과·실패·skip 수 읽기, receipt 만들기,
 * 분류·판정, release-candidate.md 렌더링. I/O 없음(scripts/release/lib.test.mjs).
 *
 * 원칙(로드맵 작업 11): 미측정·skip·기존 실패를 완료 판단에서 빼지 않는다 — 분류해 보이고,
 * 수용(acceptances.json)은 맞는 종류로만, 사유와 증거를 함께 적어야 인정한다.
 */
export const SCHEMA_VERSION = 1;
export const GROUPS = Object.freeze(['static', 'build', 'unit', 'db', 'eval', 'e2e', 'live', 'drill', 'bench']);
const ID_RE = /^[a-z0-9-]+$/;
const ACCEPT_KINDS = Object.freeze({
    'pre-existing': ['실패'],
    'accepted-skip': ['통과(skip 있음)', 'skip 수 미확인'],
    deferred: ['미측정(로컬 정책)', '환경 부재'],
});

function compiles(src) {
    try {
        new RegExp(src, 'm');
        return true;
    } catch {
        return false;
    }
}

/** 캡처 그룹 수 — 빈 대안을 붙여 빈 문자열에 늘 맞게 한 뒤 결과 배열 길이로 센다 */
function captureGroupCount(src) {
    return new RegExp(`${src}|`).exec('').length - 1;
}

export function validateCommands(doc) {
    if (!doc || doc.schemaVersion !== SCHEMA_VERSION) return [`schemaVersion 이 ${SCHEMA_VERSION} 이 아니다`];
    const errors = [];
    const rows = Array.isArray(doc.matrixRows) ? doc.matrixRows : [];
    if (rows.length === 0) errors.push('matrixRows 가 비었다');
    if (!Array.isArray(doc.commands) || doc.commands.length === 0) return [...errors, 'commands 가 비었다'];
    const seen = new Set();
    for (const [i, c] of doc.commands.entries()) {
        if (c === null || typeof c !== 'object' || Array.isArray(c)) {
            errors.push(`commands[${i}]: 객체가 아니다`);
            continue;
        }
        const where = `command ${c.id ?? '(id 없음)'}`;
        if (!ID_RE.test(c.id ?? '')) errors.push(`${where}: id 형식`);
        if (seen.has(c.id)) errors.push(`${where}: id 중복`);
        seen.add(c.id);
        if (typeof c.title !== 'string' || !c.title) errors.push(`${where}: title 없음`);
        if (!GROUPS.includes(c.group)) errors.push(`${where}: group 은 ${GROUPS.join('|')}`);
        if (typeof c.cmd !== 'string' || !c.cmd) errors.push(`${where}: cmd 없음`);
        if (!Number.isInteger(c.timeoutSec) || c.timeoutSec <= 0) errors.push(`${where}: timeoutSec 는 양의 정수`);
        if (!Array.isArray(c.requiresEnv)) errors.push(`${where}: requiresEnv 는 배열`);
        if (c.skipLocal !== null && typeof c.skipLocal !== 'string') errors.push(`${where}: skipLocal 은 null 또는 사유 문자열`);
        if (!Array.isArray(c.covers) || c.covers.some((r) => !rows.includes(r))) errors.push(`${where}: covers 는 matrixRows 의 부분집합`);
        if (c.counts !== null) {
            const s = c.counts ?? {};
            if (!['anchor', 'output'].includes(s.keysOn)) errors.push(`${where}: counts.keysOn 은 anchor|output`);
            for (const k of ['anchor', 'passed', 'failed', 'skipped']) {
                if (s[k] === undefined) continue;
                if (!compiles(s[k])) errors.push(`${where}: counts.${k} 정규식이 깨졌다`);
                // 수는 첫 캡처 그룹에서 읽는다 — 그룹이 없으면 m[1] 이 undefined 라 NaN 이 된다
                else if (k !== 'anchor' && captureGroupCount(s[k]) === 0) errors.push(`${where}: counts.${k} 정규식에 캡처 그룹 (\\d+) 가 없다`);
            }
            if (typeof s.anchor !== 'string') errors.push(`${where}: counts.anchor 없음`);
        }
    }
    return errors;
}

export function missingEnv(command, env) {
    return command.requiresEnv.filter((name) => !env[name]);
}

/** 마지막 일치의 첫 캡처를 수로. 일치 없음은 undefined, 일치했는데 수가 아니면 null(NaN 을 내보내지 않는다) */
function lastMatchNumber(text, src) {
    const re = new RegExp(src, 'gm');
    let value;
    for (const m of text.matchAll(re)) {
        const n = Number(m[1]);
        value = m[1] !== undefined && Number.isFinite(n) ? n : null;
    }
    return value;
}

/** 일치 위치가 든 줄 전체 */
function lineAt(text, index) {
    const start = text.lastIndexOf('\n', index - 1) + 1;
    const end = text.indexOf('\n', index);
    return text.slice(start, end === -1 ? text.length : end);
}

/**
 * spec 이 null 이면 null(해당 없음). anchor 를 못 찾으면 모두 null(미확인). 찾았는데 항목이 없으면 0, 수가 아니면 null.
 * keysOn anchor 면 마지막 anchor 가 시작한 줄 전체를 읽는다 — anchor 가 접두만 잡든 `.*$` 로 끝나든 결과가 같다.
 */
export function parseCounts(output, spec) {
    if (spec === null) return null;
    const anchors = [...output.matchAll(new RegExp(spec.anchor, 'gm'))];
    if (anchors.length === 0) return { passed: null, failed: null, skipped: null };
    const scope = spec.keysOn === 'anchor' ? lineAt(output, anchors[anchors.length - 1].index) : output;
    const read = (k) => {
        if (!spec[k]) return null;
        const v = lastMatchNumber(scope, spec[k]);
        return v === undefined ? 0 : v;
    };
    return { passed: read('passed'), failed: read('failed'), skipped: read('skipped') };
}

export function redactSecrets(text) {
    return text.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1***@');
}

/**
 * raw 는 runCommand 결과, 또는 실행하지 않은 경우 { skipped: 'local' } / { skipped: 'env', missing: [...] }
 */
export function buildReceipt(command, raw, meta) {
    const base = {
        schemaVersion: SCHEMA_VERSION,
        id: command.id,
        title: command.title,
        group: command.group,
        cmd: redactSecrets(command.cmd),
        gitSha: meta.gitSha,
        logFile: `receipts/${command.id}.log`,
    };
    if (raw.skipped === 'local') {
        return { ...base, startedAt: null, finishedAt: null, durationMs: 0, exitCode: null, signal: null, timedOut: false, status: 'unmeasured', reason: command.skipLocal, counts: null };
    }
    if (raw.skipped === 'env') {
        return { ...base, startedAt: null, finishedAt: null, durationMs: 0, exitCode: null, signal: null, timedOut: false, status: 'env_missing', reason: `env 없음: ${raw.missing.join(', ')}`, counts: null };
    }
    const passed = raw.exitCode === 0 && !raw.timedOut;
    let reason = null;
    if (raw.timedOut) reason = `시간 초과(${command.timeoutSec}초) — ${raw.signal ?? 'signal 없음'} 으로 종료`;
    else if (!passed) reason = raw.signal ? `signal ${raw.signal}` : `exit ${raw.exitCode}`;
    return {
        ...base,
        startedAt: raw.startedAt,
        finishedAt: raw.finishedAt,
        durationMs: raw.durationMs,
        exitCode: raw.exitCode,
        signal: raw.signal,
        timedOut: raw.timedOut,
        status: passed ? 'passed' : 'failed',
        reason,
        counts: parseCounts(raw.output, command.counts),
    };
}

function baseCategory(r) {
    if (r.status === 'unmeasured') return '미측정(로컬 정책)';
    if (r.status === 'env_missing') return '환경 부재';
    if (r.status === 'failed') return '실패';
    if (r.counts && r.counts.skipped === null) return 'skip 수 미확인';
    if (r.counts && r.counts.skipped > 0) return '통과(skip 있음)';
    return '통과';
}

export function classify(receipt, acceptance) {
    const category = baseCategory(receipt);
    if (category === '통과') return { id: receipt.id, category, accepted: false, note: '' };
    const fits = acceptance && (ACCEPT_KINDS[acceptance.kind] ?? []).includes(category);
    if (acceptance && !fits) {
        return { id: receipt.id, category, accepted: false, note: `수용 무시 — '${acceptance.kind}' 는 '${category}' 에 쓸 수 없다` };
    }
    if (fits) return { id: receipt.id, category, accepted: true, note: `수용(${acceptance.kind}): ${acceptance.reason} — 증거 ${acceptance.evidence}` };
    return { id: receipt.id, category, accepted: false, note: receipt.reason ?? '' };
}

export function validateAcceptances(doc) {
    if (!doc || doc.schemaVersion !== SCHEMA_VERSION || typeof doc.items !== 'object' || doc.items === null) {
        return ['acceptances: schemaVersion 1 과 items 객체가 필요하다'];
    }
    const errors = [];
    for (const [id, a] of Object.entries(doc.items)) {
        if (!Object.keys(ACCEPT_KINDS).includes(a?.kind)) errors.push(`${id}: kind 는 ${Object.keys(ACCEPT_KINDS).join('|')}`);
        if (typeof a?.reason !== 'string' || !a.reason) errors.push(`${id}: reason 없음`);
        if (typeof a?.evidence !== 'string' || !a.evidence) errors.push(`${id}: evidence 없음`);
    }
    return errors;
}

export function decideVerdict(classified) {
    if (classified.some((c) => c.category === '실패' && !c.accepted)) return '릴리스 후보 아님';
    if (classified.some((c) => c.category !== '통과' && !c.accepted)) return '판단 대기';
    if (classified.some((c) => c.accepted)) return '조건부 후보';
    return '후보';
}

const fmtCount = (v) => (v === null || v === undefined ? '-' : String(v));

/** receipt 들의 서로 다른 gitSha(처음 나온 순서). 둘 이상이면 한 SHA 의 증거가 아니다 */
export function receiptShas(receipts) {
    return [...new Set(receipts.map((r) => r.gitSha ?? 'unknown'))];
}

/** 명령 분류 판정에 SHA 혼합을 더한다 — 섞였으면 '후보'·'조건부 후보' 가 아니라 '판단 대기' */
export function candidateVerdict(receipts, acceptances) {
    const items = acceptances?.items ?? {};
    const verdict = decideVerdict(receipts.map((r) => classify(r, items[r.id])));
    if (receiptShas(receipts).length > 1 && verdict !== '릴리스 후보 아님') return '판단 대기';
    return verdict;
}

export function renderReleaseCandidate({ meta, receipts, commandsDoc, acceptances }) {
    const items = acceptances?.items ?? {};
    const classified = receipts.map((r) => classify(r, items[r.id]));
    const byId = new Map(classified.map((c) => [c.id, c]));
    const verdict = candidateVerdict(receipts, acceptances);
    const shas = receipts.length > 0 ? receiptShas(receipts) : [meta.gitSha];
    const shaLine = shas.length === 1
        ? `- git SHA: \`${shas[0]}\``
        : `- git SHA: **섞임(${shas.length}개)** — ${shas.map((s) => `\`${s}\``).join(', ')}`;
    const lines = [
        `# 릴리스 후보 검증 — ${meta.runId}`,
        '',
        shaLine,
        `- 작성: ${meta.createdAt}`,
        `- 판정: **${verdict}**`,
        '- 기준: 미측정·skip·기존 실패는 빼지 않고 분류한다. 수용은 acceptances.json 의 사유·증거가 있을 때만.',
        '',
        '## 명령별 결과',
        '',
        '| id | 그룹 | 상태 | 분류 | exit | 소요(초) | 통과/실패/skip | 비고 |',
        '|---|---|---|---|---|---|---|---|',
    ];
    for (const r of receipts) {
        const c = byId.get(r.id);
        const counts = r.counts ? `${fmtCount(r.counts.passed)}/${fmtCount(r.counts.failed)}/${fmtCount(r.counts.skipped)}` : '-';
        lines.push(`| ${r.id} | ${r.group} | ${r.status} | ${c.category} | ${r.exitCode ?? '-'} | ${Math.round(r.durationMs / 1000)} | ${counts} | ${c.note.replace(/\|/g, '/')} |`);
    }
    lines.push('', '## 매트릭스 행별 증거', '', '| 행 | 명령(분류) | 판정 |', '|---|---|---|');
    for (const row of commandsDoc.matrixRows) {
        const cmds = commandsDoc.commands.filter((c) => c.covers.includes(row));
        const parts = cmds.map((c) => `${c.id}(${byId.get(c.id)?.category ?? '실행 안 함'})`);
        const proven = cmds.some((c) => byId.get(c.id)?.category === '통과' || byId.get(c.id)?.category === '통과(skip 있음)');
        lines.push(`| ${row} | ${parts.join(', ') || '-'} | ${proven ? '증거 있음' : '증거 없음'} |`);
    }
    lines.push('', '## 판단이 필요한 항목', '');
    const pending = classified.filter((c) => c.category !== '통과');
    if (shas.length > 1) {
        const bySha = shas.map((sha) => `\`${sha}\`: ${receipts.filter((r) => (r.gitSha ?? 'unknown') === sha).map((r) => r.id).join(', ')}`);
        lines.push(`- git SHA 혼합 — receipt 들이 한 SHA 의 증거가 아니다. 한 SHA 로 다시 돌리거나 섞인 사유를 적는다(${bySha.join(' / ')})`);
    }
    if (pending.length === 0 && shas.length === 1) lines.push('- 없음');
    for (const c of pending) lines.push(`- ${c.id} — ${c.category}: ${c.note || '사유 없음'}${c.accepted ? '' : ' (미수용)'}`);
    return `${lines.join('\n')}\n`;
}
