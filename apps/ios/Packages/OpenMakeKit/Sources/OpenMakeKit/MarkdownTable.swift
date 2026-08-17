// OpenMakeKit — 마크다운 표 파서 (폰 화면용 구조화)
//
// 서버 answer-format 가드는 "비교는 표로 정리" 를 지시하므로 답변에 표가 자주 온다.
// 폰에서 표를 그대로 그리면 열이 좁아 읽을 수 없어, 앱은 행 단위 카드로 재구성한다.
// 파싱은 순수 로직이라 Kit 에 두고 단위 테스트로 고정한다 (렌더는 앱 책임).
import Foundation

public struct MarkdownTable: Equatable, Sendable {
    public let headers: [String]
    public let rows: [[String]]

    public init(headers: [String], rows: [[String]]) {
        self.headers = headers
        self.rows = rows
    }

    /// 행을 (헤더, 값) 쌍으로 — 첫 열은 카드 제목으로 쓰이므로 제외 가능
    public func fields(of row: [String], skippingFirst: Bool) -> [(header: String, value: String)] {
        let start = skippingFirst ? 1 : 0
        guard headers.count > start else { return [] }
        return (start..<headers.count).compactMap { index in
            let value = index < row.count ? row[index] : ""
            guard !value.isEmpty else { return nil }
            return (headers[index], value)
        }
    }
}

public enum MarkdownTableParser {
    /// 표 블록 판정 — 헤더 행 + `|---|` 구분 행이 연속으로 있어야 한다.
    public static func isTableStart(_ lines: [String], at index: Int) -> Bool {
        guard index + 1 < lines.count else { return false }
        return isRow(lines[index]) && isDivider(lines[index + 1])
    }

    /// index 부터 이어지는 표를 파싱하고, 소비한 라인 수를 함께 반환한다.
    public static func parse(_ lines: [String], from index: Int) -> (table: MarkdownTable, consumed: Int)? {
        guard isTableStart(lines, at: index) else { return nil }
        let headers = cells(in: lines[index])
        guard !headers.isEmpty else { return nil }

        var rows: [[String]] = []
        var cursor = index + 2 // 헤더 + 구분 행
        while cursor < lines.count, isRow(lines[cursor]), !isDivider(lines[cursor]) {
            let row = cells(in: lines[cursor])
            if !row.isEmpty { rows.append(row) }
            cursor += 1
        }
        guard !rows.isEmpty else { return nil }
        return (MarkdownTable(headers: headers, rows: rows), cursor - index)
    }

    private static func isRow(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.hasPrefix("|") && trimmed.dropFirst().contains("|")
    }

    /// `|---|:--:|` 형태의 정렬 구분 행
    private static func isDivider(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("|") else { return false }
        let body = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
        guard !body.isEmpty else { return false }
        return body.allSatisfy { "-: |".contains($0) } && body.contains("-")
    }

    private static func cells(in line: String) -> [String] {
        var trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("|") { trimmed.removeFirst() }
        if trimmed.hasSuffix("|") { trimmed.removeLast() }
        return trimmed
            .components(separatedBy: "|")
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }
}
