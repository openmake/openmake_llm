/**
 * 계약 산출물 export — packages/api-contracts 재생성 (축 1 Step 3)
 *
 * 실행: npm run contracts:export
 *
 * 산출물 (결정적 출력 — 재실행 시 diff 0 이어야 하며 CI 가 drift 를 검사):
 *  - packages/api-contracts/openapi.v1.json          REST 계약 (SoT: apps/api/src/swagger/spec-core.ts)
 *  - packages/api-contracts/events/ws-chat.v1.schema.json
 *        WS 채팅 이벤트 계약 (SoT: packages/shared-types 의 WsChatRequest·WsServerEvent)
 *
 * 원칙:
 *  - 산출물 수기 편집 금지 — TS SoT 수정 후 본 스크립트로 재생성.
 *  - env 비의존: info.version 은 앱 버전이 아닌 계약 버전(CONTRACT_VERSION),
 *    servers 는 미포함 (클라이언트가 serverURL 을 주입 — 배포 URL 하드코딩 방지).
 *  - breaking change 는 파일 추가(v2)로만 — 기존 v1 파일의 호환 파괴 변경 금지.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createGenerator } from 'ts-json-schema-generator';
import { API_DESCRIPTION, specTags, specPaths, specComponents } from '../apps/api/src/swagger/spec-core';

/** REST/WS 계약 버전 — 릴리스(APP_VERSION)와 독립. breaking change 시에만 v2 파일 추가 */
const CONTRACT_VERSION = '1.0.0';

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'packages', 'api-contracts');
const SHARED_TYPES_ENTRY = path.join(ROOT, 'packages', 'shared-types', 'src', 'index.ts');
const SHARED_TYPES_TSCONFIG = path.join(ROOT, 'packages', 'shared-types', 'tsconfig.json');

/** WS 계약으로 추출할 shared-types 루트 타입 */
const WS_CONTRACT_TYPES = ['WsChatRequest', 'WsServerEvent'] as const;

function writeJson(relPath: string, value: unknown): void {
    const target = path.join(OUT_DIR, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
    console.log(`  ✓ ${path.relative(ROOT, target)}`);
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
    return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'en'))) as T;
}

function exportOpenApi(): void {
    const spec = {
        openapi: '3.0.3',
        info: {
            title: 'OpenMake.Ai API',
            description: API_DESCRIPTION,
            version: CONTRACT_VERSION,
        },
        tags: specTags,
        paths: specPaths,
        components: specComponents,
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    };
    writeJson('openapi.v1.json', spec);
}

function exportWsSchema(): void {
    const definitions: Record<string, unknown> = {};
    for (const type of WS_CONTRACT_TYPES) {
        const schema = createGenerator({
            path: SHARED_TYPES_ENTRY,
            tsconfig: SHARED_TYPES_TSCONFIG,
            type,
            // 미지 필드 무시-허용 (forward-compat) — 서버 이벤트/필드 추가가 구 클라이언트를 깨지 않게
            additionalProperties: true,
            skipTypeCheck: true,
        }).createSchema(type);
        Object.assign(definitions, schema.definitions ?? {});
    }
    writeJson('events/ws-chat.v1.schema.json', {
        $schema: 'http://json-schema.org/draft-07/schema#',
        title: 'openmake-ws-chat',
        description:
            'WS 채팅 프로토콜 계약 — SoT: packages/shared-types (WsChatRequest 송신 / WsServerEvent 수신). ' +
            '클라이언트는 미지 이벤트 type 을 무시해야 한다 (forward-compat).',
        version: CONTRACT_VERSION,
        definitions: sortKeys(definitions),
    });
}

console.log('[contracts:export] 계약 산출물 재생성');
exportOpenApi();
exportWsSchema();
console.log('[contracts:export] 완료');
