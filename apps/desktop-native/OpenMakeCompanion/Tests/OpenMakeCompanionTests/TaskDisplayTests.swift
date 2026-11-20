// 작업 창 표시 대응표(PR-3.3 D-258·D-266) — 서버 값 → 키(+인자)·색. `swift test` 에선 번들 문구를 읽을 수 없어(F-35) 키를 대조한다.
import XCTest
import OmkFfi
@testable import OpenMakeCompanion

func iso(_ state: String, branch: String? = nil, worktreeRel: String? = nil, rootRel: String? = nil,
         outcome: String? = nil, ignoredOnly: Bool? = nil, reason: String? = nil) -> IsolationRecord {
    IsolationRecord(state: state, branch: branch, worktreeRel: worktreeRel, rootRel: rootRel, outcome: outcome,
                    ignoredOnly: ignoredOnly, reason: reason)
}

func phrase(_ key: String, _ args: [String] = []) -> Phrase { Phrase(key: key, args: args) }

/** 대응표가 만들 수 있는 Phrase 전부 — LocalizationTableTests 가 인자 수를 대조한다. */
let allIsolationSamples: [IsolationRecord] = [
    iso("worktree", branch: "b"),
    iso("worktree", branch: "b", worktreeRel: "w", rootRel: "r", outcome: "kept"),
    iso("worktree", branch: "b", worktreeRel: "w", outcome: "kept", ignoredOnly: true),
    iso("worktree", branch: "b", outcome: "removed"),
    iso("direct", reason: "not_repo"),
    iso("direct", reason: "disabled"),
    iso("direct", reason: "unavailable"),
]
let allStatuses = ["pending", "queued", "running", "paused", "completed", "failed", "cancelled"]
let allErrorKinds: [ErrorKind] = [.auth, .offline, .rateLimited, .tooLarge, .decode, .server(503), .input, .internal]

final class TaskDisplayTests: XCTestCase {
    /** T-S1 — 알려진 7개 → 키, 모르는 값·빈 값 → 원문. 색 표. */
    func testStatusLabelAndTone() {
        for s in allStatuses { XCTAssertEqual(TaskDisplay.statusLabel(s), .phrase(phrase("task.status.\(s)"))) }
        XCTAssertEqual(TaskDisplay.statusLabel("zz_future"), .raw("zz_future"))
        XCTAssertEqual(TaskDisplay.statusLabel(""), .raw(""))
        XCTAssertEqual(TaskDisplay.statusLabel("Running"), .raw("Running")) // 대소문자도 서버 값 그대로
        for s in ["running", "queued", "pending", "paused"] { XCTAssertEqual(TaskDisplay.statusTone(s), .accent) }
        XCTAssertEqual(TaskDisplay.statusTone("completed"), .green)
        XCTAssertEqual(TaskDisplay.statusTone("failed"), .red)
        XCTAssertEqual(TaskDisplay.statusTone("cancelled"), .gray)
        XCTAssertEqual(TaskDisplay.statusTone("zz"), .gray)
    }

    /** T-S2 — 웹 isolationLabel 과 같은 분기·인자(branch, path), 모르는 값 → nil. 목록 브랜치는 그 판정을 따른다. */
    func testIsolationLabel() {
        let want: [Phrase] = [
            phrase("task.isolation.worktree", ["b"]),
            phrase("task.isolation.worktreeKept", ["b", "r"]),
            phrase("task.isolation.worktreeKeptIgnored", ["b", "w"]), // rootRel 없으면 worktreeRel
            phrase("task.isolation.worktreeRemoved"),
            phrase("task.isolation.notRepo"),
            phrase("task.isolation.disabled"),
            phrase("task.isolation.unavailable"),
        ]
        XCTAssertEqual(allIsolationSamples.map(TaskDisplay.isolationLabel), want)
        XCTAssertEqual(TaskDisplay.isolationLabel(iso("worktree", branch: "b", outcome: "kept", ignoredOnly: false)),
                       phrase("task.isolation.worktreeKept", ["b", ""]))
        XCTAssertNil(TaskDisplay.isolationLabel(nil))
        XCTAssertNil(TaskDisplay.isolationLabel(iso("zz", branch: "b")))
        XCTAssertNil(TaskDisplay.isolationLabel(iso("worktree", branch: "b", outcome: "zz")))
        XCTAssertNil(TaskDisplay.isolationLabel(iso("direct", reason: "zz")))
        XCTAssertNil(TaskDisplay.isolationLabel(iso("direct")))
        // 목록 행 브랜치 — 대응표가 그리는 경우만(재검토 r1 L-4)
        XCTAssertEqual(TaskDisplay.listBranch(iso("worktree", branch: "b")), "b")
        XCTAssertEqual(TaskDisplay.listBranch(iso("worktree", branch: "b", outcome: "removed")), "b")
        XCTAssertNil(TaskDisplay.listBranch(iso("worktree", branch: "b", outcome: "zz")))
        XCTAssertNil(TaskDisplay.listBranch(iso("zz", branch: "b")))
        XCTAssertNil(TaskDisplay.listBranch(iso("worktree")))
        XCTAssertNil(TaskDisplay.listBranch(iso("worktree", branch: "")))
        XCTAssertNil(TaskDisplay.listBranch(nil))
    }

    /** T-S3 — ISO 8601 두 형식, 해석 실패 → 원문, locale 주입으로 형식이 갈린다(번들·시스템 언어 무관). */
    func testDateText() {
        let ko = Locale(identifier: "ko"), en = Locale(identifier: "en")
        let a = TaskDisplay.dateText("2026-11-21T01:02:03.456Z", locale: ko)
        let b = TaskDisplay.dateText("2026-11-21T01:02:03Z", locale: ko)
        XCTAssertNotNil(a)
        XCTAssertEqual(a, b)
        XCTAssertNotEqual(a, "2026-11-21T01:02:03.456Z")
        XCTAssertNotEqual(TaskDisplay.dateText("2026-11-21T01:02:03Z", locale: en), b)
        XCTAssertEqual(TaskDisplay.dateText("어제", locale: ko), "어제")
        XCTAssertNil(TaskDisplay.dateText(nil, locale: ko))
    }

    /** T-S4 — diff 20000·그 밖 4000(같음·하나 넘음), Character 단위라 서로게이트 쌍 중간에서 자르지 않는다. */
    func testClipped() {
        let s4000 = String(repeating: "a", count: 4000)
        XCTAssertEqual(TaskDisplay.clipped(s4000, stepType: "tool_call").text, s4000)
        XCTAssertFalse(TaskDisplay.clipped(s4000, stepType: "tool_call").clipped)
        let c = TaskDisplay.clipped(s4000 + "b", stepType: "tool_call")
        XCTAssertEqual(c.text, s4000)
        XCTAssertTrue(c.clipped)
        XCTAssertFalse(TaskDisplay.clipped(s4000 + "b", stepType: "diff").clipped)
        let s20000 = String(repeating: "d", count: 20000)
        XCTAssertFalse(TaskDisplay.clipped(s20000, stepType: "diff").clipped)
        XCTAssertEqual(TaskDisplay.clipped(s20000 + "x", stepType: "diff").text, s20000)
        let emoji = String(repeating: "😀", count: 4001) // UTF-16 으로는 8002
        let e = TaskDisplay.clipped(emoji, stepType: "x")
        XCTAssertEqual(e.text, String(repeating: "😀", count: 4000))
        XCTAssertTrue(e.clipped)
    }

    /** T-S5 — 폴더 null·빈 값 → "연결 폴더" 키, 값 → 원문. */
    func testFolderLabel() {
        XCTAssertEqual(TaskDisplay.folderLabel(nil), .phrase(phrase("tasks.folder.root")))
        XCTAssertEqual(TaskDisplay.folderLabel(""), .phrase(phrase("tasks.folder.root")))
        XCTAssertEqual(TaskDisplay.folderLabel("sub/dir"), .raw("sub/dir"))
    }

    /** 오류 범주 → 키(server 는 status 문자열 인자). phraseKeys 는 대응표가 낼 수 있는 키 전부. */
    func testErrorPhraseAndPhraseKeys() {
        XCTAssertEqual(TaskDisplay.errorPhrase(.server(503)), phrase("tasks.err.server", ["503"]))
        XCTAssertEqual(TaskDisplay.errorPhrase(.auth), phrase("tasks.err.auth"))
        XCTAssertEqual(TaskDisplay.errorPhrase(.internal), phrase("tasks.err.internal"))
        var produced: [String] = allErrorKinds.map { TaskDisplay.errorPhrase($0).key }
        produced += allIsolationSamples.compactMap { TaskDisplay.isolationLabel($0)?.key }
        produced += allStatuses.compactMap { if case let .phrase(p) = TaskDisplay.statusLabel($0) { return p.key }; return nil }
        if case let .phrase(p) = TaskDisplay.folderLabel(nil) { produced.append(p.key) }
        XCTAssertEqual(Set(produced), Set(TaskDisplay.phraseKeys))
        XCTAssertEqual(TaskDisplay.phraseKeys.count, Set(TaskDisplay.phraseKeys).count)
    }
}
