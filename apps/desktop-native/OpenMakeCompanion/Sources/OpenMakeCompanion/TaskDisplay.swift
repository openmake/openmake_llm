// 작업 창 표시 대응표(PR-3.3 D-258·D-266) — 서버 값 → 문구 키(+인자)·색. 계산·판정 없음, 모르는 값은 원문 또는 안 그림(웹과 같음).
// 문구 키는 리터럴로만 쓴다(이어 붙인 키 금지) — 표 쪽은 LocalizationTableTests 가 저장소 .strings 5개로 대조한다.
import Foundation
import OmkFfi

/** 문구 키 + 인자(문자열). 뷰는 TaskDisplay.text 로 그린다. */
struct Phrase: Equatable {
    let key: String
    let args: [String]
    init(key: String, args: [String] = []) {
        self.key = key
        self.args = args
    }
}

/** 문구(키) 또는 서버 원문. */
enum Label: Equatable {
    case phrase(Phrase)
    case raw(String)
}

enum StatusTone: Equatable { case accent, green, red, gray }

enum TaskDisplay {
    /** 대응표가 돌려줄 수 있는 키 전부(시험이 표와 대조한다). */
    static let phraseKeys: [String] = [
        "task.status.pending", "task.status.queued", "task.status.running", "task.status.paused",
        "task.status.completed", "task.status.failed", "task.status.cancelled",
        "task.isolation.worktree", "task.isolation.worktreeKept", "task.isolation.worktreeKeptIgnored",
        "task.isolation.worktreeRemoved", "task.isolation.notRepo", "task.isolation.disabled", "task.isolation.unavailable",
        "tasks.folder.root",
        "tasks.err.auth", "tasks.err.offline", "tasks.err.rateLimited", "tasks.err.tooLarge", "tasks.err.decode",
        "tasks.err.server", "tasks.err.input", "tasks.err.internal",
    ]

    /** 상태 — 알려진 7개(서버 unified-database.types.ts)는 웹 statusRaw 와 같은 문구, 모르는 값은 원문. */
    static func statusLabel(_ s: String) -> Label {
        switch s {
        case "pending": return .phrase(Phrase(key: "task.status.pending"))
        case "queued": return .phrase(Phrase(key: "task.status.queued"))
        case "running": return .phrase(Phrase(key: "task.status.running"))
        case "paused": return .phrase(Phrase(key: "task.status.paused"))
        case "completed": return .phrase(Phrase(key: "task.status.completed"))
        case "failed": return .phrase(Phrase(key: "task.status.failed"))
        case "cancelled": return .phrase(Phrase(key: "task.status.cancelled"))
        default: return .raw(s)
        }
    }

    static func statusTone(_ s: String) -> StatusTone {
        switch s {
        case "running", "queued", "pending", "paused": return .accent
        case "completed": return .green
        case "failed": return .red
        default: return .gray
        }
    }

    /** 격리 — 웹 lib/agent-task-isolation.ts isolationLabel 과 같은 분기. 인자는 (branch, path) 순 — 표는 %1$@·%2$@. */
    static func isolationLabel(_ i: IsolationRecord?) -> Phrase? {
        guard let i else { return nil }
        switch i.state {
        case "worktree":
            let branch = i.branch ?? ""
            switch i.outcome {
            case "kept":
                let path = i.rootRel ?? i.worktreeRel ?? ""
                return Phrase(key: i.ignoredOnly == true ? "task.isolation.worktreeKeptIgnored" : "task.isolation.worktreeKept",
                              args: [branch, path])
            case "removed": return Phrase(key: "task.isolation.worktreeRemoved")
            case nil: return Phrase(key: "task.isolation.worktree", args: [branch])
            default: return nil
            }
        case "direct":
            switch i.reason {
            case "not_repo": return Phrase(key: "task.isolation.notRepo")
            case "disabled": return Phrase(key: "task.isolation.disabled")
            case "unavailable": return Phrase(key: "task.isolation.unavailable")
            default: return nil
            }
        default: return nil
        }
    }

    /** 목록 행의 브랜치 — 상세가 격리 문구를 그리는 경우에만(재검토 r1 L-4). */
    static func listBranch(_ i: IsolationRecord?) -> String? {
        guard isolationLabel(i) != nil, let b = i?.branch, !b.isEmpty else { return nil }
        return b
    }

    /** 폴더 — null·빈 값은 서버 의미 "루트"(연결 폴더). */
    static func folderLabel(_ f: String?) -> Label {
        guard let f, !f.isEmpty else { return .phrase(Phrase(key: "tasks.folder.root")) }
        return .raw(f)
    }

    /** ISO 8601(소수 초 있음/없음) → locale 의 날짜·시각. 해석 실패면 원문. */
    static func dateText(_ s: String?, locale: Locale) -> String? {
        guard let s else { return nil }
        let frac = ISO8601DateFormatter()
        frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = frac.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return s }
        return d.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened).locale(locale))
    }

    /** 표시 상한 — 웹과 같은 숫자(diff 20000, 그 밖 4000), 단위는 Character(서로게이트·결합 문자 중간에서 자르지 않는다). */
    static func clipped(_ s: String, stepType: String) -> (text: String, clipped: Bool) {
        let limit = stepType == "diff" ? 20000 : 4000
        guard s.count > limit else { return (s, false) }
        return (String(s.prefix(limit)), true)
    }

    static func errorPhrase(_ k: ErrorKind) -> Phrase {
        switch k {
        case .auth: return Phrase(key: "tasks.err.auth")
        case .offline: return Phrase(key: "tasks.err.offline")
        case .rateLimited: return Phrase(key: "tasks.err.rateLimited")
        case .tooLarge: return Phrase(key: "tasks.err.tooLarge")
        case .decode: return Phrase(key: "tasks.err.decode")
        case let .server(status): return Phrase(key: "tasks.err.server", args: [String(status)])
        case .input: return Phrase(key: "tasks.err.input")
        case .internal: return Phrase(key: "tasks.err.internal")
        }
    }

    /** L() 과 같은 조회. */
    static func text(_ p: Phrase) -> String {
        let format = NSLocalizedString(p.key, comment: "")
        return p.args.isEmpty ? format : String(format: format, arguments: p.args)
    }

    static func text(_ l: Label) -> String {
        switch l {
        case let .phrase(p): return text(p)
        case let .raw(s): return s
        }
    }

    /** 앱 언어 로캘(시각 표시). */
    static var appLocale: Locale { Locale(identifier: Bundle.main.preferredLocalizations.first ?? "ko") }
}
