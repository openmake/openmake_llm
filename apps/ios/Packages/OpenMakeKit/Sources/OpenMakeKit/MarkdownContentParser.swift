import Foundation

public enum MarkdownContentSegment: Equatable, Sendable {
    case text(String)
    case image(alt: String, source: String)
}

public enum MarkdownContentParser {
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
