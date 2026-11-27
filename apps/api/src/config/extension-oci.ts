/**
 * @module config/extension-oci
 * @description OCI 레지스트리 확장 설치(마켓플레이스 계획 v3.5 P8) — 플래그·상한·허용 미디어 타입.
 *
 * `EXTENSION_OCI_INSTALL_ENABLED`(기본 OFF, system_settings 실시간) — 켜면 `oci://registry/repo:tag` 또는
 * `oci://registry/repo@sha256:<digest>` 를 확장 설치 원본으로 받는다(OCI Distribution API 직접 호출, 외부 바이너리 없음).
 * 꺼져 있으면 `oci://` 는 원본으로 인식되지 않아 종전처럼 `INVALID_GIT_URL` 로 거절된다(판정·원본 정책 모두 종전 그대로).
 *
 * 태그는 설치 시점의 매니페스트 digest 로 고정해 `source_ref` 에 기록한다 — 업데이트 확인 = 같은 태그의 새 digest.
 * 레이어는 tar · tar+gzip 만(아래 화이트리스트), 해제 크기·파일 수·경로 탈출 방어는 ZIP 설치와 같은 함수(archive-fetcher).
 */
import { getConfig } from './env';

export const EXTENSION_OCI_INSTALL_FLAG = 'EXTENSION_OCI_INSTALL_ENABLED';

export function extensionOciInstallEnabled(): boolean {
    return getConfig().extensionOciInstallEnabled;
}

/** 원본 URL 스킴 */
export const OCI_SOURCE_PREFIX = 'oci://';

/** 매니페스트 요청 Accept — 단일 이미지 매니페스트만(인덱스는 플랫폼 선택이 없어 거절) */
export const OCI_MANIFEST_MEDIA_TYPES = [
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
] as const;

/** 인덱스(멀티 플랫폼) 매니페스트 — 알아보고 명시 거절한다 */
export const OCI_INDEX_MEDIA_TYPES = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
] as const;

/** 레이어 미디어 타입 화이트리스트 → 압축 방식. 목록 밖 레이어가 하나라도 있으면 설치 거절 */
export const OCI_LAYER_MEDIA_TYPES: Readonly<Record<string, 'tar' | 'gzip'>> = {
    'application/vnd.oci.image.layer.v1.tar': 'tar',
    'application/vnd.oci.image.layer.v1.tar+gzip': 'gzip',
    'application/vnd.docker.image.rootfs.diff.tar.gzip': 'gzip',
};

/** Docker Hub 별칭 → 정책 비교용 정규 이름 / 실제 API 호스트 */
export const OCI_DOCKER_HUB = {
    aliases: ['docker.io', 'index.docker.io', 'registry-1.docker.io'],
    canonical: 'docker.io',
    apiHost: 'registry-1.docker.io',
    officialNamespace: 'library',
} as const;

const int = (name: string, fallback: number): number => {
    const v = parseInt(process.env[name] || '', 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** 상한(env 오버라이드, 재시작 반영). 해제 크기·파일 수 기본값은 ZIP 설치(EXTENSION_INGEST_ARCHIVE_*)와 같다 */
export const EXTENSION_OCI_LIMITS = {
    get manifestMaxBytes(): number { return int('EXTENSION_OCI_MANIFEST_MAX_BYTES', 256 * 1024); },
    get maxLayers(): number { return int('EXTENSION_OCI_MAX_LAYERS', 16); },
    /** 레이어(압축 상태) 합계 상한 */
    get maxBlobBytes(): number { return int('EXTENSION_OCI_MAX_BLOB_BYTES', 10 * 1024 * 1024); },
    get maxEntries(): number { return int('EXTENSION_OCI_MAX_ENTRIES', 2000); },
    /** 해제 후 총 크기 상한(압축 폭탄 방어 — gunzip 출력 상한으로도 건다) */
    get maxTotalBytes(): number { return int('EXTENSION_OCI_MAX_TOTAL_BYTES', 50 * 1024 * 1024); },
    /** 토큰 교환 응답 상한 */
    get tokenMaxBytes(): number { return int('EXTENSION_OCI_TOKEN_MAX_BYTES', 64 * 1024); },
    get requestTimeoutMs(): number { return int('EXTENSION_OCI_REQUEST_TIMEOUT_MS', 30_000); },
} as const;
