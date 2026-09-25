/**
 * 모델 프로필 실측 프로브 CLI (S2) — 실제 요청을 보낸다(모델당 8회 + --audio/--video 를 주면 각 1회, 순차, 출력 256토큰 상한).
 *
 *   npm run eval:probe -- --model qwen3.8-27b                      # 로컬(LiteLLM 게이트웨이)
 *   npm run eval:probe -- --model bai:glm-5.3-flash --user 3        # 외부 — 그 사용자의 BYOK 키로 provider 직결
 *   npm run eval:probe -- --model nvidia:a/b,hasa:c --user 3        # 여러 개(순차)
 *
 * 출력은 `LLM_MODEL_PROFILES_JSON` 에 넣을 수 있는 조각 + 판정 근거다. 프로필에 반영한 뒤 `eval:matrix --gate` 로 전환을 판정한다.
 * 외부는 게이트웨이가 아니라 provider 에 직결한다 — 재려는 것은 모델의 수락 범위이지 게이트웨이의 변환이 아니다.
 *
 * @module evaluation/run-model-probe
 */
import * as fs from 'fs';
import * as path from 'path';

if (require.main === module) {
    require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
}

import { AUDIO_ANALYZE_DEFAULT_FORMAT, AUDIO_ANALYZE_FORMATS } from '../config/capabilities';
import { mimeFromName } from '../services/orchestrator/media-io';
import { IMAGE_FIXTURE_DIR } from './dataset-loader';
import { parseListArg } from './matrix-reporter';
import { judgeProbe, runProbe, type ProbeHttpResult, type ProbeMediaInput, type ProbePost } from './model-probe';

/** 비전 프로브 픽스처 — 숫자 한 글자 이미지와 그 정답 */
const VISION_FIXTURE = { file: 'digit-7.png', answer: '7', question: 'Which single digit is shown in this image? Answer with the digit only.' };

/** 미디어 프로브 기본 질문 — 정답(--audio-answer/--video-answer)이 함께 와야 "내용 이해" 를 확정한다 */
const DEFAULT_AUDIO_QUESTION = 'What do you hear in this audio? Describe it briefly.';
const DEFAULT_VIDEO_QUESTION = 'What happens in this video? Describe it briefly.';

/** --audio/--video 로 넘긴 샘플 파일을 프로브 입력으로 읽는다(넘기지 않으면 undefined → 미디어 프로브 생략) */
function readMediaInput(): ProbeMediaInput | undefined {
    const audioPath = argValue('--audio');
    const videoPath = argValue('--video');
    if (!audioPath && !videoPath) return undefined;
    const media: ProbeMediaInput = {};
    if (audioPath) {
        const mime = (mimeFromName(audioPath) || '').split(';')[0].trim().toLowerCase();
        media.audio = {
            base64: fs.readFileSync(audioPath).toString('base64'),
            format: AUDIO_ANALYZE_FORMATS[mime] ?? AUDIO_ANALYZE_DEFAULT_FORMAT,
            question: argValue('--audio-question') ?? DEFAULT_AUDIO_QUESTION,
            answer: argValue('--audio-answer'),
        };
    }
    if (videoPath) {
        const mime = mimeFromName(videoPath) || 'video/mp4';
        media.video = {
            dataUrl: `data:${mime};base64,${fs.readFileSync(videoPath).toString('base64')}`,
            question: argValue('--video-question') ?? DEFAULT_VIDEO_QUESTION,
            answer: argValue('--video-answer'),
        };
    }
    return media;
}

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

function httpPoster(endpoint: string, apiKey: string, timeoutMs: number): ProbePost {
    return async (payload): Promise<ProbeHttpResult> => {
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(timeoutMs),
            });
            const text = await res.text();
            if (payload.stream === true) {
                return { status: res.status, body: null, sseChunks: text.split('\n').filter((l) => l.startsWith('data:')).length };
            }
            let body: Record<string, unknown> | null = null;
            try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* 비JSON 본문 */ }
            return { status: res.status, body };
        } catch (e) {
            return { status: 0, body: null, error: e instanceof Error ? e.message : String(e) };
        }
    };
}

/** 대상 해석 — bare id 는 로컬 게이트웨이, `provider:model` 은 그 사용자의 등록 키 */
interface ProbeTarget { endpoint: string; apiKey: string; model: string; profileKey: string; effortExtra: Record<string, unknown> }

/** 앱이 로컬 경로에서 싣는 것과 같은 게이트웨이 통과 힌트 (llm/reasoning-adapter) */
const GATEWAY_EFFORT_HINT = { allowed_openai_params: ['reasoning_effort'] };

async function resolveTarget(fullId: string, userId: string | undefined): Promise<ProbeTarget> {
    const idx = fullId.indexOf(':');
    const providerId = idx > 0 ? fullId.slice(0, idx) : null;
    const { getProviderCatalogEntry } = await import('../config/external-providers');
    if (!providerId || !getProviderCatalogEntry(providerId)) {
        const base = (process.env.LLM_BASE_URL ?? '').replace(/\/+$/, '');
        if (!base) throw new Error('LLM_BASE_URL 미설정');
        return { endpoint: `${base}/chat/completions`, apiKey: process.env.LLM_API_KEY ?? 'sk-no-key', model: fullId, profileKey: fullId.toLowerCase(), effortExtra: GATEWAY_EFFORT_HINT };
    }
    if (!userId) throw new Error(`외부 모델 '${fullId}' 은 --user <id> 가 필요합니다(그 사용자의 등록 키를 씁니다)`);
    const { Pool } = await import('pg');
    const { ExternalKeysRepository } = await import('../data/repositories/external-keys-repo');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
        const repo = new ExternalKeysRepository(pool);
        const row = await repo.getByUserAndProvider(userId, providerId);
        if (!row) throw new Error(`user ${userId} 는 '${providerId}' 키를 등록하지 않았습니다`);
        if (row.authMethod === 'oauth') throw new Error(`'${providerId}' 는 OAuth provider 라 직결 프로브 대상이 아닙니다`);
        const key = await repo.decryptKey(userId, providerId);
        if (!key || !row.baseUrl) throw new Error(`'${providerId}' 키 복호화 실패 또는 base_url 없음`);
        const model = fullId.slice(idx + 1);
        return { endpoint: `${row.baseUrl.replace(/\/+$/, '')}/chat/completions`, apiKey: key, model, profileKey: `${providerId}:${model}`.toLowerCase(), effortExtra: {} };
    } finally {
        await pool.end();
    }
}

async function main(): Promise<void> {
    const models = parseListArg(argValue('--model') ?? argValue('--models'), []);
    if (models.length === 0) {
        console.error('사용법: npm run eval:probe -- --model <id[,id…]> [--user <id>] [--audio <path> --audio-answer <text>] [--video <path> --video-answer <text>] (외부 모델은 provider:model + --user)');
        process.exit(1);
    }
    const timeoutMs = Number(process.env.OMK_EVAL_PROBE_TIMEOUT_MS ?? '120000');
    const delayMs = Number(process.env.OMK_EVAL_PROBE_DELAY_MS ?? '3000');
    const image = fs.readFileSync(path.join(IMAGE_FIXTURE_DIR, VISION_FIXTURE.file)).toString('base64');
    const media = readMediaInput();
    const fragment: Record<string, unknown> = {};
    let unreachable = 0;
    for (const fullId of models) {
        const target = await resolveTarget(fullId, argValue('--user'));
        console.log(`\n[probe] ${fullId} → ${new URL(target.endpoint).host}`);
        const observations = await runProbe(httpPoster(target.endpoint, target.apiKey, timeoutMs), target.model, image, VISION_FIXTURE.question, target.effortExtra, delayMs, media);
        const verdict = judgeProbe(observations, VISION_FIXTURE.answer, { audio: media?.audio?.answer, video: media?.video?.answer });
        for (const n of verdict.notes) console.log(`  - ${n}`);
        if (verdict.unreachable) { unreachable++; continue; }
        console.log(`  프로필: ${JSON.stringify(verdict.profile)}`);
        if (Object.keys(verdict.profile).length > 0) fragment[target.profileKey] = verdict.profile;
    }
    console.log(`\nLLM_MODEL_PROFILES_JSON 조각:\n${JSON.stringify(fragment)}`);
    if (unreachable > 0) process.exit(2);
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error('[model-probe] 실패:', e instanceof Error ? e.message : e);
        process.exit(1);
    });
}
