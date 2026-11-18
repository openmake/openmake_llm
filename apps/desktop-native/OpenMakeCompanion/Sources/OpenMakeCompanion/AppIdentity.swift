// 정체성 상수(plan-pr2.4 D-149) — 옛 정체성(이 앱)·후속 앱(OpenMake Code)의 이름·번들 ID·매니페스트 블록·파일명 접두.
// PR-2.5 에서 정체성을 뒤집을 때 이 파일 하나만 보면 되게 글자를 한곳에 모은다.
import Foundation

enum AppIdentity {
    /** 이 앱(옛 정체성). build.sh 의 BUNDLE_ID 와 같아야 한다. */
    static let bundleId = "cc.openmake.companion"
    /** 이 앱이 읽는 매니페스트 블록 — 같은 정체성 업데이트. */
    static let sameIdentityBlock = "native"

    /** 후속 앱 — dmg 안 `<이름>.app`, 번들 ID, 매니페스트 블록, 파일명 접두. */
    static let successorName = "OpenMake Code"
    static let successorBundleId = "cc.openmake.code"
    static let successorBlock = "macos"
    static let successorFilePrefix = "OpenMake-Code-"

    /** 후속 앱 교체가 실패한 버전(D-145) — 기동 때 자동 확인은 이 버전을 건너뛴다. 교체 스크립트도 이 키로 적는다. */
    static let successorFailedVersionKey = "update.successorFailedVersion"

    /** 지원 폴더(D-2 로 불변) — FIFO(`key-handoff`)·교체 진행 표식이 함께 산다. */
    static let supportDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/OpenMakeCompanion").path
    /** 교체 진행 표식(D-151·§3.2.2) — 내용 `<스크립트 PID> <그 프로세스 시작 시각 epoch 초>` 한 줄. 다리가 나간 뒤에는 형식을 못 바꾼다. */
    static let successorPendingPath = supportDirectory + "/successor-pending"
}
