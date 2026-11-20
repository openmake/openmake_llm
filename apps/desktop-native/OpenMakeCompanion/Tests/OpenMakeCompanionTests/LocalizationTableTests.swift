// 저장소의 5개 문구 표를 직접 읽는다(PR-3.3 D-266) — `swift test` 에선 L() 이 키를 돌려주므로(F-35) 문구 쪽 위험(빠진 키·형식
// 지정자 불일치 → String(format:) 오출력)을 표 파일로 본다. check-l10n.sh 가 보지 않는 switch 키·지정자를 덮는다(F-36).
import XCTest
@testable import OpenMakeCompanion

let locales = ["ko", "en", "ja", "zh-Hans", "de"]

/** apps/desktop-native/Localization — 이 파일에서 네 단계 위. */
func localizationTable(_ lang: String) -> [String: String]? {
    let base = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Localization")
    return NSDictionary(contentsOf: base.appendingPathComponent("\(lang).lproj/Localizable.strings")) as? [String: String]
}

/** 형식 지정자 (위치 또는 순번, 종류) — `%%` 는 뺀다. */
func specifiers(_ s: String) -> [String] {
    let re = try! NSRegularExpression(pattern: "%%|%(\\d+\\$)?(@|ld|d)")
    var ordinal = 0
    return re.matches(in: s, range: NSRange(s.startIndex..., in: s)).compactMap { m in
        let all = String(s[Range(m.range, in: s)!])
        if all == "%%" { return nil }
        ordinal += 1
        let pos = Range(m.range(at: 1), in: s).map { String(s[$0].dropLast()) } ?? String(ordinal)
        return "\(pos):\(s[Range(m.range(at: 2), in: s)!])"
    }.sorted()
}

final class LocalizationTableTests: XCTestCase {
    /** 이 PR 의 새 키 — 접두 task.·tasks. 와 menu.openTasks. */
    static func isNew(_ k: String) -> Bool { k.hasPrefix("task.") || k.hasPrefix("tasks.") || k == "menu.openTasks" }

    /** T-S12 ①~③ — 5개 표, 새 키·phraseKeys 가 모두 있고, 지정자 다중집합이 ko 와 같다. */
    func testTablesHaveNewKeysWithMatchingSpecifiers() throws {
        let tables = try locales.map { try XCTUnwrap(localizationTable($0), "표 없음: \($0)") }
        let ko = tables[0]
        let newKeys = ko.keys.filter(Self.isNew)
        XCTAssertEqual(newKeys.count, 42)
        XCTAssertTrue(Set(TaskDisplay.phraseKeys).isSubset(of: newKeys))
        for (lang, t) in zip(locales, tables) {
            for k in newKeys {
                guard let v = t[k] else { XCTFail("\(lang): \(k) 없음"); continue }
                XCTAssertEqual(specifiers(v), specifiers(ko[k]!), "\(lang): \(k)")
            }
        }
        // 인자 2개 이상이면 위치 지정 꼴만(어순이 다른 언어 대비, D-259)
        let plain = try NSRegularExpression(pattern: "%(@|ld|d)")
        for (lang, t) in zip(locales, tables) {
            for k in newKeys where specifiers(ko[k]!).count > 1 {
                let v = t[k] ?? ""
                XCTAssertEqual(plain.numberOfMatches(in: v, range: NSRange(v.startIndex..., in: v)), 0, "\(lang): \(k)")
            }
        }
    }

    /** T-S12 ④ — 대응표가 만드는 Phrase 마다 인자 수 = 그 키의 지정자 수. */
    func testPhraseArgsMatchSpecifiers() throws {
        let ko = try XCTUnwrap(localizationTable("ko"))
        var phrases: [Phrase] = allErrorKinds.map(TaskDisplay.errorPhrase)
        phrases += allIsolationSamples.compactMap(TaskDisplay.isolationLabel)
        for s in allStatuses { if case let .phrase(p) = TaskDisplay.statusLabel(s) { phrases.append(p) } }
        if case let .phrase(p) = TaskDisplay.folderLabel(nil) { phrases.append(p) }
        XCTAssertEqual(Set(phrases.map(\.key)), Set(TaskDisplay.phraseKeys))
        for p in phrases {
            XCTAssertEqual(specifiers(try XCTUnwrap(ko[p.key], p.key)).count, p.args.count, p.key)
        }
    }

    func testSpecifierParser() {
        XCTAssertEqual(specifiers("a %1$@ b %2$@ 100%%"), ["1:@", "2:@"])
        XCTAssertEqual(specifiers("%@ (%ld)"), ["1:@", "2:ld"])
        XCTAssertEqual(specifiers("%2$@ x %1$@"), ["1:@", "2:@"])
    }
}
