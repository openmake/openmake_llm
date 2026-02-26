/**
 * RAG 임베딩 성능 벤치마크
 *
 * 다양한 배치 사이즈에서 임베딩 생성 성능을 측정합니다.
 * 실행: npx tsx scripts/rag-benchmark.ts
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

// 테스트 텍스트 생성 — 실제 문서 청크와 유사한 길이
function generateChunks(count: number, avgLen: number = 800): string[] {
    const base = 'OpenMake LLM은 Ollama 기반 셀프 호스팅 AI 어시스턴트 플랫폼입니다. ' +
        '단일 노드부터 분산 클러스터까지 확장 가능하며 7가지 브랜드 모델 프로파일과 자동 라우팅으로 ' +
        '질문 유형별 최적 응답을 제공합니다. pgvector를 활용한 RAG 파이프라인으로 문서 기반 검색 보강 생성을 지원합니다. ';

    const chunks: string[] = [];
    for (let i = 0; i < count; i++) {
        let text = `[Chunk ${i + 1}/${count}] `;
        while (text.length < avgLen) {
            text += base;
        }
        chunks.push(text.substring(0, avgLen));
    }
    return chunks;
}

// Ollama embed API 호출
async function embedBatch(texts: string[]): Promise<{ embeddings: number[][]; durationMs: number }> {
    const start = Date.now();
    const resp = await fetch(`${OLLAMA_HOST}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });

    if (!resp.ok) {
        throw new Error(`Ollama embed failed: ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json() as { embeddings: number[][] };
    const durationMs = Date.now() - start;
    return { embeddings: data.embeddings, durationMs };
}

// 배치 단위로 분할하여 임베딩 생성
async function runBenchmark(totalChunks: number, batchSize: number): Promise<{
    batchSize: number;
    totalChunks: number;
    totalMs: number;
    avgPerChunkMs: number;
    avgPerBatchMs: number;
    batchCount: number;
    throughput: number; // chunks/sec
}> {
    const chunks = generateChunks(totalChunks);
    const batchCount = Math.ceil(chunks.length / batchSize);
    let totalMs = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const { durationMs } = await embedBatch(batch);
        totalMs += durationMs;
    }

    return {
        batchSize,
        totalChunks,
        totalMs,
        avgPerChunkMs: totalMs / totalChunks,
        avgPerBatchMs: totalMs / batchCount,
        batchCount,
        throughput: (totalChunks / totalMs) * 1000,
    };
}

// 워밍업
async function warmup(): Promise<void> {
    console.log('🔥 워밍업 (첫 번째 요청은 모델 로딩 포함)...');
    await embedBatch(['warmup test']);
    console.log('✅ 워밍업 완료\n');
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  RAG 임베딩 성능 벤치마크');
    console.log(`  Model: ${EMBEDDING_MODEL}`);
    console.log(`  Ollama: ${OLLAMA_HOST}`);
    console.log('═══════════════════════════════════════════════════\n');

    await warmup();

    const TOTAL_CHUNKS = 64;
    const BATCH_SIZES = [1, 4, 8, 16, 32, 64];
    const results: Awaited<ReturnType<typeof runBenchmark>>[] = [];

    for (const bs of BATCH_SIZES) {
        process.stdout.write(`⏱  배치 사이즈 ${String(bs).padStart(2)} ... `);
        const result = await runBenchmark(TOTAL_CHUNKS, bs);
        results.push(result);
        console.log(`${result.totalMs}ms total | ${result.avgPerChunkMs.toFixed(1)}ms/chunk | ${result.throughput.toFixed(1)} chunks/s`);
    }

    // 결과 표
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  결과 요약');
    console.log('═══════════════════════════════════════════════════');
    console.log('│ Batch │ Batches │ Total(ms) │ ms/chunk │ chunks/s │');
    console.log('├───────┼─────────┼───────────┼──────────┼──────────┤');
    for (const r of results) {
        console.log(
            `│ ${String(r.batchSize).padStart(5)} │ ${String(r.batchCount).padStart(7)} │ ${String(r.totalMs).padStart(9)} │ ${r.avgPerChunkMs.toFixed(1).padStart(8)} │ ${r.throughput.toFixed(1).padStart(8)} │`
        );
    }
    console.log('└───────┴─────────┴───────────┴──────────┴──────────┘');

    // 최적 배치 사이즈 결정
    const best = results.reduce((a, b) => a.throughput > b.throughput ? a : b);
    console.log(`\n🏆 최적 배치 사이즈: ${best.batchSize} (${best.throughput.toFixed(1)} chunks/s, ${best.avgPerChunkMs.toFixed(1)}ms/chunk)`);

    // RAG_CONFIG 권장값
    const currentBatchSize = 32;
    if (best.batchSize !== currentBatchSize) {
        console.log(`\n💡 권장: RAG_CONFIG.EMBEDDING_BATCH_SIZE를 ${currentBatchSize} → ${best.batchSize}로 변경`);
    } else {
        console.log(`\n✅ 현재 RAG_CONFIG.EMBEDDING_BATCH_SIZE=${currentBatchSize}는 최적값입니다.`);
    }
}

main().catch(console.error);
