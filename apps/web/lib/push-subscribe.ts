/**
 * 웹 푸시 켜기 — 브라우저 구독을 확보하고 서버(/api/push/subscribe)에 등록한다.
 * 서버 등록이 실패하면 이번에 새로 만든 브라우저 구독은 해제해 되돌리고, 원래 오류를 던진다
 * (호출처가 토글을 꺼짐으로 두고 오류를 보이도록). 순수 로직 — 브라우저 API·ApiClient 는 주입받는다.
 */

export interface PushSubscriptionLike {
  endpoint: string;
  toJSON(): { keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface EnablePushDeps {
  getSubscription: () => Promise<PushSubscriptionLike | null>;
  createSubscription: () => Promise<PushSubscriptionLike>;
  register: (body: { endpoint: string; keys?: Record<string, string> }) => Promise<unknown>;
}

export async function enablePushSubscription(deps: EnablePushDeps): Promise<void> {
  let sub = await deps.getSubscription();
  const created = !sub;
  if (!sub) sub = await deps.createSubscription();
  try {
    await deps.register({ endpoint: sub.endpoint, keys: sub.toJSON().keys });
  } catch (err) {
    if (created) {
      // 되돌리기 실패는 무시하고 원래 등록 오류를 보인다
      await sub.unsubscribe().catch(() => undefined);
    }
    throw err;
  }
}

/**
 * 설정 화면 진입 시 초기 토글 상태 — 브라우저 구독이 남아 있으면 서버에 다시 등록해 맞춘다.
 * 서버는 같은 endpoint 를 덮어쓴다(캐시 Map·DB ON CONFLICT upsert)라 중복이 생기지 않는다.
 * 구독이 없으면 false, 등록 성공이면 true, 실패면 서버 오류를 던진다(브라우저 구독은 그대로 둔다).
 */
export async function syncExistingPushSubscription(
  deps: Pick<EnablePushDeps, "getSubscription" | "register">,
): Promise<boolean> {
  const sub = await deps.getSubscription();
  if (!sub) return false;
  await deps.register({ endpoint: sub.endpoint, keys: sub.toJSON().keys });
  return true;
}

/**
 * 초기 재등록 실패 구분 — 서버 검증 거부(400·422, 예: 허용되지 않는 push 호스트)면 true(꺼짐+오류 문구).
 * 그 밖(네트워크 오류·401·403·429·5xx 등)은 일시 오류로 false(브라우저 구독이 있으니 켜짐 유지, 문구 없음).
 * ApiClient 의 ApiError 는 숫자 `status` 필드를 가진다.
 */
export function isPushRegistrationRejected(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return status === 400 || status === 422;
}
