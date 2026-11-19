// 정체성 상수(plan-pr2.4 D-149·plan-pr2.5 D-153) — 이 앱 = OpenMake Code. 옛 정체성(OpenMake Companion)은 첫 실행 이전용.
// 정체성 글자는 이 파일 하나에 모은다. build.sh 의 APP_NAME·BUNDLE_ID 사본은 IdentityTests 가 글자로 대조한다.
import Foundation

enum AppIdentity {
    /** 이 앱 — dmg 안 `<이름>.app`·실행 파일 이름, 번들 ID, Keychain 서비스. */
    static let appName = "OpenMake Code"
    static let bundleId = "cc.openmake.code"
    static let keychainService = "cc.openmake.code"
    /** 이 앱이 읽는 매니페스트 블록과 그 파일명 접두(D-155 — `native` 는 읽지 않는다). */
    static let updateBlock = "macos"
    static let filePrefix = "OpenMake-Code-"

    /** 옛 정체성(첫 실행 이전 — LegacyMigration). */
    static let legacyBundleId = "cc.openmake.companion"
    static let legacyAppName = "OpenMake Companion"
    static let legacyKeychainService = "cc.openmake.companion"
    /** 옛 도메인에서 옮기는 기본값 허용 목록(HelperManager 가 쓰는 키). */
    static let legacyDefaultsKeys = ["server", "backend", "lastFolders", "lastFolder", "browserEnabled"]
    /** 다리(0.4.x)의 교체 스크립트 이름 — 표식 PID 가 이 스크립트인지 가린다(D-157). 다리 쪽에서 고정된 값. */
    static let bridgeScriptName = "successor-replace.sh"

    /** 지원 폴더(D-2 로 불변) — FIFO(`key-handoff`)·교체 진행 표식이 함께 산다. */
    static let supportDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/OpenMakeCompanion").path
    /** 교체 진행 표식(D-151·§3.2.2) — 내용 `<스크립트 PID> <그 프로세스 시작 시각 epoch 초>` 한 줄. 다리가 나간 뒤에는 형식을 못 바꾼다. */
    static let successorPendingPath = supportDirectory + "/successor-pending"
}
