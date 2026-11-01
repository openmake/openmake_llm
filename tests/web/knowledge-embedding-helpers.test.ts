import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KnowledgeEmbeddingStatus, KnowledgeEmbeddingState } from '@openmake/shared-types';
import {
  blockedReasonKey,
  canOfferReindex,
  embeddingErrorKey,
  embeddingStatusKey,
  failureMessageKey,
  indexStatusKey,
  isEmbeddingKeyFailure,
  needsEmbeddingSettings,
  splitBlockedReasons,
} from '../../apps/web/addons/knowledge/helpers';

// 서버가 주는 값 전부 — apps/api/src/addons/knowledge-runtime (ingestion/errors.ts FAILURE_CODES, embedding/readiness.ts, capabilities.ts)
const STATUSES: KnowledgeEmbeddingStatus[] = ['ready', 'unpinned', 'unassigned', 'key_missing', 'key_rejected', 'reindexing'];
const NEW_FAILURES = ['EMBEDDING_KEY_MISSING', 'EMBEDDING_KEY_REJECTED', 'FAILED_VERIFICATION'];
const ERROR_CODES = ['EMBEDDING_KEY_MISSING', 'EMBEDDING_KEY_REJECTED', 'EMBEDDING_UNASSIGNED', 'EMBEDDING_PROVIDER_UNAVAILABLE', 'REINDEX_NOT_NEEDED', 'REINDEX_IN_PROGRESS'];
const INDEX_STATUSES = ['ready', 'retired', 'building'];
const BLOCKED = ['PGVECTOR_MISSING', 'EMBEDDING_UNASSIGNED', 'EMBEDDING_KEY_MISSING', 'EMBEDDING_KEY_REJECTED', 'EMBEDDING_PROVIDER_UNAVAILABLE', 'NO_SUPPORTED_MIME_TYPES', 'PARSER_REGISTRY_UNAVAILABLE'];

function lookup(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

test('새 실패 코드는 전용 문구 키로, 미등록은 failure.unknown', () => {
  assert.equal(failureMessageKey('EMBEDDING_KEY_MISSING'), 'failure.embeddingKeyMissing');
  assert.equal(failureMessageKey('EMBEDDING_KEY_REJECTED'), 'failure.embeddingKeyRejected');
  assert.equal(failureMessageKey('FAILED_VERIFICATION'), 'failure.verification');
  assert.equal(failureMessageKey('NOPE'), 'failure.unknown');
  assert.equal(isEmbeddingKeyFailure('EMBEDDING_KEY_REJECTED'), true);
  assert.equal(isEmbeddingKeyFailure('FAILED_EMBEDDING'), false);
});

test('서버 오류 코드 → 안내 키, 설정 링크는 키·배정 문제만', () => {
  assert.equal(embeddingErrorKey('EMBEDDING_KEY_MISSING'), 'embedding.error.keyMissing');
  assert.equal(embeddingErrorKey('REINDEX_IN_PROGRESS'), 'embedding.error.reindexInProgress');
  assert.equal(embeddingErrorKey('DUPLICATE_DOCUMENT'), null);
  assert.equal(needsEmbeddingSettings('EMBEDDING_UNASSIGNED'), true);
  assert.equal(needsEmbeddingSettings('EMBEDDING_PROVIDER_UNAVAILABLE'), false);
  assert.equal(blockedReasonKey('EMBEDDING_KEY_MISSING'), 'blocked.EMBEDDING_KEY_MISSING');
  assert.equal(blockedReasonKey('SOMETHING_NEW'), null);
});

test('capabilities 사유는 플랫폼(전 사용자 공통)과 요청 사용자 임베딩으로 나뉜다 — 상세 배너·관리자 배지는 플랫폼 사유만 본다', () => {
  assert.deepEqual(splitBlockedReasons(BLOCKED), {
    platform: ['PGVECTOR_MISSING', 'NO_SUPPORTED_MIME_TYPES', 'PARSER_REGISTRY_UNAVAILABLE'],
    embedding: ['EMBEDDING_UNASSIGNED', 'EMBEDDING_KEY_MISSING', 'EMBEDDING_KEY_REJECTED', 'EMBEDDING_PROVIDER_UNAVAILABLE'],
  });
  assert.deepEqual(splitBlockedReasons(['EMBEDDING_KEY_MISSING']), { platform: [], embedding: ['EMBEDDING_KEY_MISSING'] });
  assert.deepEqual(splitBlockedReasons([]), { platform: [], embedding: [] });
  // 모르는 코드는 플랫폼 쪽(숨기지 않는다)
  assert.deepEqual(splitBlockedReasons(['SOMETHING_NEW']), { platform: ['SOMETHING_NEW'], embedding: [] });
});

test('색인 카탈로그 상태 값 → i18n 키, 미등록 값은 null(원문)', () => {
  assert.equal(indexStatusKey('ready'), 'admin.indexStatusValue.ready');
  assert.equal(indexStatusKey('retired'), 'admin.indexStatusValue.retired');
  assert.equal(indexStatusKey('building'), 'admin.indexStatusValue.building');
  assert.equal(indexStatusKey('purging'), null);
});

test('재색인 버튼은 서버 상태로만 — 편집 권한·현재 설정이 있고 mismatch 이거나 키·미고정 상태, 진행 중이면 숨김', () => {
  const embedding = (over: Partial<KnowledgeEmbeddingState>): KnowledgeEmbeddingState => ({
    index: null, status: 'ready', mismatch: false, effective: { providerRef: 'p:m', modelId: 'p/m', source: 'user' }, ...over,
  });
  assert.equal(canOfferReindex({ canEdit: true, embedding: embedding({ mismatch: true }) }), true);
  assert.equal(canOfferReindex({ canEdit: true, embedding: embedding({ status: 'key_missing' }) }), true);
  assert.equal(canOfferReindex({ canEdit: true, embedding: embedding({ status: 'unpinned' }) }), true);
  assert.equal(canOfferReindex({ canEdit: true, embedding: embedding({}) }), false);
  assert.equal(canOfferReindex({ canEdit: false, embedding: embedding({ mismatch: true }) }), false);
  assert.equal(canOfferReindex({ canEdit: true, embedding: embedding({ status: 'reindexing', mismatch: true }) }), false);
  assert.equal(canOfferReindex({ canEdit: true, embedding: embedding({ mismatch: true, effective: null }) }), false);
});

test('새 knowledge 문구 키가 모든 locale 에 있다', () => {
  const keys = [
    ...STATUSES.map(embeddingStatusKey),
    ...NEW_FAILURES.map(failureMessageKey),
    ...ERROR_CODES.map((c) => embeddingErrorKey(c)!),
    ...BLOCKED.map((c) => blockedReasonKey(c)!),
    'embedding.indexModel', 'embedding.notPinned', 'embedding.mismatch', 'embedding.reindex', 'embedding.reindexConfirmTitle',
    'embedding.reindexConfirmBody', 'embedding.createNotice', 'embedding.createWarn', 'embedding.openSettings',
    'admin.indexModel', 'admin.indexDimension', 'admin.indexStatus', 'admin.indexSpaces', 'admin.noIndexes',
    ...INDEX_STATUSES.map((v) => indexStatusKey(v)!), 'admin.embeddingByRequester',
  ];
  const dir = join(process.cwd(), 'apps/web/messages');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const knowledge = JSON.parse(readFileSync(join(dir, file), 'utf8')).knowledge;
    for (const key of keys) assert.equal(typeof lookup(knowledge, key), 'string', `${file} knowledge.${key}`);
    // 전역 재색인 문구는 제거됐다
    assert.equal(lookup(knowledge, 'admin.reindex'), undefined, `${file} knowledge.admin.reindex`);
  }
});
