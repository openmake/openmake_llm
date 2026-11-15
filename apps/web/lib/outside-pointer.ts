/**
 * 눌린 곳이 주어진 상자들 모두의 바깥인지 — 팝오버·시트의 바깥 클릭 닫기 판단(document pointerdown).
 * 아직 붙지 않은 ref(null)는 건너뛴다.
 */
export function isOutside(target: Node | null, containers: ReadonlyArray<Node | null>): boolean {
  return containers.every((c) => !c || !c.contains(target));
}
