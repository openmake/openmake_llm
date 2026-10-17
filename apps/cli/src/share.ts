/**
 * share 명령 — 작업 결과를 읽기 전용 링크로 공유(미리보기 → 확인 → 게시).
 * index.ts 에서 분리(파일 크기 가드).
 */
import { ApiClient, type ShareDocument } from './api';
import { prompt, requireConfig } from './cli-common';

/** 공유 문서를 사람이 읽을 형태로 — "무엇이 공개되는지"를 게시 전에 그대로 보여준다. */
function printSharePreview(doc: ShareDocument): void {
    console.log('\x1b[1m─ 공개될 내용 ─────────────────────────\x1b[0m');
    console.log(`상태: ${doc.status} · 턴 ${doc.summary.turns} · 도구 호출 ${doc.summary.toolCalls}회`
        + `${doc.summary.retries ? ` · 재시도 ${doc.summary.retries}회` : ''}`
        + `${doc.summary.diffs ? ` · diff ${doc.summary.diffs}건` : ''}`);
    if (doc.goal) console.log(`\n\x1b[1m목표\x1b[0m\n${doc.goal}`);
    if (doc.result) console.log(`\n\x1b[1m결과\x1b[0m\n${doc.result}`);
    if (doc.steps.length) {
        console.log(`\n\x1b[1m진행 기록\x1b[0m (${doc.steps.length}건)`);
        for (const st of doc.steps.slice(0, 20)) console.log(`  \x1b[2m${st.n}\x1b[0m ${st.tool ?? st.type}: ${st.text}`);
        if (doc.steps.length > 20) console.log(`  \x1b[2m… 외 ${doc.steps.length - 20}건\x1b[0m`);
    }
    if (doc.artifacts.length) {
        console.log(`\n\x1b[1m산출물\x1b[0m (${doc.artifacts.length}건)`);
        for (const a of doc.artifacts) {
            console.log(`  ${a.title} \x1b[2m(${a.kind}${a.body ? `, 본문 ${a.body.length}자` : ', 본문 제외'})\x1b[0m`);
        }
    }
    if (doc.diffs.length) console.log(`\n\x1b[1m변경분\x1b[0m ${doc.diffs.length}건 (${doc.diffs.reduce((n, d) => n + d.length, 0)}자)`);
    console.log('\x1b[1m──────────────────────────────────────\x1b[0m');
    console.log('\x1b[2m경로·자격증명은 자동 정화되지만 완전하지 않습니다 — 위 내용을 직접 확인하세요.\x1b[0m');
}

/**
 * 공유 — 게시는 되돌릴 수 있지만(해제) **이미 본 사람은 되돌릴 수 없다**. 그래서 항상
 * 미리보기를 먼저 출력하고, TTY 면 y/N 확인, 비대화형이면 `--yes` 를 요구한다.
 */
export async function cmdShare(taskId: string, opts: {
    link: boolean; steps: boolean; diff: boolean; artifacts: boolean; off: boolean;
    previewOnly: boolean; republish: boolean; openArtifacts: boolean; yes: boolean;
}): Promise<void> {
    const cfg = requireConfig();
    const api = new ApiClient(cfg.serverUrl, cfg.apiKey);

    if (opts.off) {
        const r = await api.unshare(taskId);
        console.log(r.unshared ? '\x1b[32m✓ 공유를 해제했습니다 — 링크는 더 이상 열리지 않습니다.\x1b[0m' : '공유 중이 아닙니다.');
        return;
    }

    const { share } = await api.getShare(taskId).catch(() => ({ share: null }));

    if (opts.openArtifacts) {
        if (!share) { console.error('공유 중이 아닙니다 — 먼저 `openmake-code share <taskId>` 로 게시하세요.'); process.exit(1); }
        const { document } = await api.getSharedTask(share.shareId, share.shareToken);
        if (!document.artifacts.length) { console.log('산출물이 없습니다.'); return; }
        console.log(`\x1b[1m산출물 열람 URL\x1b[0m \x1b[2m(발급 토큰은 유효기간이 있습니다)\x1b[0m`);
        for (const [i, a] of document.artifacts.entries()) {
            if (!a.viewerId) {
                // 뷰어가 없는 경우(뷰어 기능 off·본문 없음) — 본문이 문서에 있으면 그걸로 대신한다.
                console.log(`  ${i}. ${a.title} \x1b[2m(${a.kind} — 뷰어 없음${a.body ? `, 본문 ${a.body.length}자는 공유 페이지에서` : ''})\x1b[0m`);
                continue;
            }
            try {
                const { url } = await api.openSharedArtifact(share.shareId, i, share.shareToken);
                console.log(`  ${i}. ${a.title} \x1b[2m(${a.kind})\x1b[0m\n     ${url}`);
            } catch (e) {
                console.log(`  ${i}. ${a.title} \x1b[31m— URL 발급 실패: ${(e as Error).message}\x1b[0m`);
            }
        }
        return;
    }
    if (share && !opts.previewOnly && !opts.republish) {
        // 이미 공유 중 — 링크만 다시 보여준다(재게시는 내용 변경이므로 명시적으로).
        console.log(`\x1b[32m이미 공유 중\x1b[0m (${share.visibility}${share.includeDiff ? ', diff 포함' : ''})`);
        console.log(`  ${cfg.serverUrl}${share.path}`);
        console.log('\x1b[2m산출물 열람: `--open` · 최신 내용으로 다시 게시: `--republish` · 해제: `--off`\x1b[0m');
        return;
    }

    const toggles = { includeSteps: opts.steps, includeDiff: opts.diff, includeArtifacts: opts.artifacts };
    const { preview } = await api.previewShare(taskId, toggles);
    printSharePreview(preview);
    if (opts.previewOnly) { console.log('\x1b[2m(미리보기만 — 게시되지 않았습니다)\x1b[0m'); return; }

    if (opts.republish && share) console.log('\x1b[2m재게시 — 기존 링크는 그대로 유지되고 내용만 갱신됩니다.\x1b[0m');
    const visibility = opts.link ? 'link' : (opts.republish && share ? share.visibility : 'authenticated');
    // 안내 문구는 **결정된 visibility** 에서 뽑는다 — 플래그(opts.link)로 뽑으면 재게시 때
    // 실제로는 공개 링크를 내면서 "로그인 사용자에게만" 이라고 말하게 된다(확인 질문 포함).
    const scope = visibility === 'link' ? '링크를 아는 누구나(로그인 불필요)' : '이 서버에 로그인한 사용자';
    if (!opts.yes) {
        if (!process.stdin.isTTY) {
            console.error(`\n비대화형에서는 --yes 가 필요합니다 (공개 범위: ${scope}).`);
            process.exit(1);
        }
        const ans = (await prompt(`\n위 내용을 ${scope}에게 공개합니다. 게시할까요? (y/N): `)).toLowerCase();
        if (ans !== 'y' && ans !== 'yes') { console.log('취소했습니다.'); return; }
    }

    const r = await api.publishShare(taskId, { visibility, ...toggles });
    console.log(`\x1b[32m✓ 공유됨\x1b[0m (${scope})`);
    console.log(`  ${cfg.serverUrl}${r.path}`);
    if (preview.artifacts.length) console.log(`\x1b[2m산출물 ${preview.artifacts.length}건 열람 URL: openmake-code share ${taskId} --open\x1b[0m`);
    console.log('\x1b[2m해제: openmake-code share ' + taskId + ' --off\x1b[0m');
}
