import Foundation

public enum MarkdownContentSegment: Equatable, Sendable {
    case text(String)
    case image(alt: String, source: String)
}

public enum MarkdownContentParser {
    /// 서버가 아티팩트 본문을 치환해 넣는 표기 — `[[artifact:id]]` / `[[artifact:id:v2]]`
    /// (llm/artifact-parser.ts 와 동일 grammar). 아티팩트는 별도 카드로 보여주므로
    /// 본문에서는 걷어낸다 — 남겨두면 raw 텍스트가 그대로 노출된다 (2026-08-18 실측).
    static let artifactPlaceholder = #"\[\[artifact:[^\]]+\]\]"#

    /// 아티팩트 placeholder 제거 + 그로 인해 남는 빈 줄 정리
    public static func strippingArtifactPlaceholders(_ content: String) -> String {
        guard content.contains("[[artifact:") else { return content }
        let cleaned = content.replacingOccurrences(
            of: artifactPlaceholder,
            with: "",
            options: .regularExpression)
        return cleaned
            .components(separatedBy: "\n")
            .reduce(into: [String]()) { lines, line in
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                // placeholder 만 있던 줄이 빈 줄로 남아 연속 공백이 되는 것을 막는다
                if trimmed.isEmpty, lines.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { return }
                lines.append(line)
            }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func segments(in content: String) -> [MarkdownContentSegment] {
        let pattern = #"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else {
            return [.text(content)]
        }
        let matches = expression.matches(
            in: content,
            range: NSRange(content.startIndex..<content.endIndex, in: content))
        guard !matches.isEmpty else { return [.text(content)] }

        var result: [MarkdownContentSegment] = []
        var cursor = content.startIndex
        for match in matches {
            guard let whole = Range(match.range(at: 0), in: content),
                  let alt = Range(match.range(at: 1), in: content),
                  let source = Range(match.range(at: 2), in: content) else { continue }
            if cursor < whole.lowerBound {
                result.append(.text(String(content[cursor..<whole.lowerBound])))
            }
            result.append(.image(
                alt: String(content[alt]),
                source: String(content[source])))
            cursor = whole.upperBound
        }
        if cursor < content.endIndex {
            result.append(.text(String(content[cursor...])))
        }
        return result.isEmpty ? [.text(content)] : result
    }
}

public enum GeneratedImageURLResolver {
    public static func resolve(source: String, serverURL: URL) -> URL? {
        guard let resolved = URL(string: source, relativeTo: serverURL)?.absoluteURL,
              resolved.scheme?.lowercased() == serverURL.scheme?.lowercased(),
              resolved.host?.lowercased() == serverURL.host?.lowercased(),
              resolved.port == serverURL.port,
              resolved.path.hasPrefix("/generated/") else { return nil }
        return resolved
    }
}
