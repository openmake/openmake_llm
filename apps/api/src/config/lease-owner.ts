/**
 * 실행 소유권(lease)의 owner — 이 프로세스를 가리키는 이름. `호스트명:PM2 인스턴스 번호`.
 *
 * 같은 자리에서 다시 뜬 프로세스는 같은 이름을 가져, 부팅 때 "내 작업"을 바로 알아본다(다른 서버의 실행 중 작업은 건드리지 않는다).
 * 부팅 초기화(data/models/schema-initializer)와 작업 실행(services/agent-task/task-lease)이 같이 쓴다.
 *
 * @module config/lease-owner
 */
import { hostname } from 'os';

/** PURE: owner 문자열 — 영숫자·`._-` 만 남긴다(부팅 SQL 에 리터럴로 들어간다). */
export function sanitizeLeaseOwner(host: string, instance: string): string {
    const clean = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, '_');
    return `${clean(host)}:${clean(instance)}`;
}

let owner: string | null = null;
/**
 * 이 프로세스의 owner — PM2 는 NODE_APP_INSTANCE 로 인스턴스 번호를 준다(단일 프로세스는 0).
 * OMK_LEASE_INSTANCE 가 있으면 그것을 쓴다 — 서버와 같은 호스트에서 따로 뜨는 프로세스(평가 실행기)가 서버와 같은 이름을 쓰면,
 * 부팅 정리가 서로의 실행 중 작업을 "내 것"으로 보고 failed 로 바꾼다.
 */
export function leaseOwner(): string {
    owner ??= sanitizeLeaseOwner(hostname(), process.env.OMK_LEASE_INSTANCE ?? process.env.NODE_APP_INSTANCE ?? '0');
    return owner;
}
