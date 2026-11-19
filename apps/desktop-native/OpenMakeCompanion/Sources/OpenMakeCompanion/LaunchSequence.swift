// 기동 조율(plan-pr2.5 D-173·§4.1) — 순서를 한 함수에 두어 단위로 고정한다.
// FIFO 소비(KeyHandoff.consume)는 applicationDidFinishLaunching 안에서 동기로 맨 먼저 돌고 이 함수는 그 결과만 받는다 —
// Task 지연 사이에 Keychain 조회가 consume 앞에 끼지 않게(D-119·§4.1 1, 리뷰 r1 M-1(b)).
// migrate(옛 앱 종료 대기·이전) → [.proceed 일 때만] connect → requestNotifications
// → offerTrash(휴지통 ○ 일 때만, 주 큐 다음 차례) → scheduleUpdateCheck.
// .blocked 순서: migrate → scheduleUpdateCheck — connect·requestNotifications·offerTrash 각 0회.
import Foundation

enum MigrationOutcome: Equatable {
    /** 이전을 마쳤거나 할 것이 없다 — 연결한다. trash 가 있으면 그 옛 번들의 휴지통 이동을 한 번 묻는다. */
    case proceed(trash: URL?)
    /** 옛 앱이 끝나지 않았다(D-159) — 이번 실행은 이전·연결을 하지 않는다. */
    case blocked
}

struct LaunchSteps {
    var migrate: () async -> MigrationOutcome
    var connect: () -> Void
    var requestNotifications: () -> Void
    var offerTrash: (URL) -> Void
    var scheduleUpdateCheck: () -> Void
}

enum LaunchSequence {
    @MainActor
    static func run(keyHandoff: KeyHandoff.Result, _ steps: LaunchSteps) async {
        NSLog("OpenMake Code launch: key handoff \(keyHandoff)")
        if case let .proceed(trash) = await steps.migrate() {
            steps.connect()
            steps.requestNotifications()
            if let trash {
                await Task.yield() // 연결 시작이 먼저 돌게 주 큐 다음 차례로 미룬다(D-160)
                steps.offerTrash(trash)
            }
        }
        steps.scheduleUpdateCheck()
    }
}
