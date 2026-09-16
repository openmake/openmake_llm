/**
 * 디버그 큐 재현 번들 리플레이 CLI (F24.7)
 *
 * 사용법:
 *   npm run replay:request -- <debug_queue_id> --dry-run            # 번들 요약만(LLM 호출 없음)
 *   npm run replay:request -- <debug_queue_id> [--model qwen3.8-27b] [--temperature 0]
 *
 * 운영 DB(DATABASE_URL)와 게이트웨이(LLM_BASE_URL)를 루트 .env 에서 읽는다. 실제 LLM 호출은 비용이 든다.
 *
 * @module scripts/replay-request
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

import { getDebugCaptureForReplay } from '../data/conversation-debug-queue';
import { runReplay } from '../services/replay/replay-runner';

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    const id = process.argv.slice(2).find((a) => !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1] !== '--model' && process.argv[process.argv.indexOf(a) - 1] !== '--temperature');
    if (!id) throw new Error('debug_queue_id 가 필요합니다');
    const row = await getDebugCaptureForReplay(id);
    if (!row) throw new Error(`항목 없음(만료 가능): ${id}`);
    if (!row.replayBundle) throw new Error('재현 번들이 없는 항목입니다');
    const b = row.replayBundle;
    const roles = b.messages.reduce<Record<string, number>>((m, x) => ({ ...m, [x.role]: (m[x.role] ?? 0) + 1 }), {});
    console.log(`항목 ${row.id} (${row.reason}${row.errorCode ? `, ${row.errorCode}` : ''}) request=${row.requestId ?? '-'}`);
    console.log(`모델 ${b.provider.fullId} · 메시지 ${JSON.stringify(roles)} · 도구 ${b.tools?.length ?? 0} · 절단 ${b.truncated}`);
    console.log(`사용자: ${row.userMessage.slice(0, 200)}`);
    if (process.argv.includes('--dry-run')) return;
    const temperature = arg('--temperature') !== undefined ? Number(arg('--temperature')) : undefined;
    const r = await runReplay(b, { model: arg('--model'), temperature, expected: row.assistantMessage });
    console.log(`\n리플레이 ${r.model} · ${r.durationMs}ms · 도구 호출 ${r.toolCalls.join(', ') || '없음'} · 저장 응답과 유사도 ${r.similarity?.toFixed(3)}`);
    console.log(`\n--- 리플레이 응답 ---\n${r.content.slice(0, 2000)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(`[replay] ${e instanceof Error ? e.message : e}`); process.exit(1); });
