import Foundation

public enum MarkdownContentSegment: Equatable, Sendable {
    case text(String)
    case image(alt: String, source: String)
    /// 생성 영상 링크 — `[🎬 영상 보기](/generated/x.webm)` (오케스트레이터 결정적 첨부)
    case video(title: String, source: String)
    /// 생성 음성 링크 — `[🔊 음성 듣기](/generated/x.wav)`
    case audio(title: String, source: String)
}

public enum MarkdownContentParser {
    /// 서버가 아티팩트 본문을 치환해 넣는 표기 — `[[artifact:id]]` / `[[artifact:id:v2]]`
    /// (llm/artifact-parser.ts 와 동일 grammar). 아티팩트는 별도 카드로 보여주므로
    /// 본문에서는 걷어낸다 — 남겨두면 raw 텍스트가 그대로 노출된다 (2026-08-18 실측).
    static let artifactPlaceholder = #"\[\[artifact:[^\]]+\]\]"#

    /// 미디어로 취급하는 링크 확장자 — 서버 generated-media 가 저장하는 형식(webm·mp4·wav·mp3 …)
    public static let videoExtensions: Set<String> = ["webm", "mp4", "mov", "m4v"]
    public static let audioExtensions: Set<String> = ["mp3", "wav", "m4a", "ogg", "opus", "flac", "aac"]

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

    /// 본문을 텍스트/이미지/영상/음성 세그먼트로 나눈다.
    /// 이미지는 `![alt](src)`, 영상·음성은 확장자가 미디어인 일반 링크 `[title](src)` 만 —
    /// 그 밖의 링크는 텍스트에 그대로 남겨 인라인 마크다운이 처리한다.
    public static func segments(in content: String) -> [MarkdownContentSegment] {
        let pattern = #"(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else {
            return [.text(content)]
        }
        let matches = expression.matches(
            in: content,
            range: NSRange(content.startIndex..<content.endIndex, in: content))
        guard !matches.isEmpty else { return [.text(content)] }

        var result: [MarkdownContentSegment] = []
        var pendingText = ""
        var cursor = content.startIndex

        func flushText() {
            if !pendingText.isEmpty {
                result.append(.text(pendingText))
                pendingText = ""
            }
        }

        for match in matches {
            guard let whole = Range(match.range(at: 0), in: content),
                  let bang = Range(match.range(at: 1), in: content),
                  let label = Range(match.range(at: 2), in: content),
                  let source = Range(match.range(at: 3), in: content) else { continue }
            if cursor < whole.lowerBound {
                pendingText += content[cursor..<whole.lowerBound]
            }
            let src = String(content[source])
            let title = String(content[label])
            if !content[bang].isEmpty {
                flushText()
                result.append(.image(alt: title, source: src))
            } else if let kind = mediaKind(of: src) {
                flushText()
                switch kind {
                case .video: result.append(.video(title: title, source: src))
                case .audio: result.append(.audio(title: title, source: src))
                }
            } else {
                // 일반 링크 — 텍스트로 유지
                pendingText += content[whole]
            }
            cursor = whole.upperBound
        }
        if cursor < content.endIndex {
            pendingText += content[cursor...]
        }
        flushText()
        return result.isEmpty ? [.text(content)] : result
    }

    enum MediaKind { case video, audio }

    static func mediaKind(of source: String) -> MediaKind? {
        // 쿼리·프래그먼트 제거 후 확장자 판정
        let path = source.split(separator: "?", maxSplits: 1).first.map(String.init) ?? source
        let ext = (path as NSString).pathExtension.lowercased()
        guard !ext.isEmpty else { return nil }
        if videoExtensions.contains(ext) { return .video }
        if audioExtensions.contains(ext) { return .audio }
        return nil
    }
}

/// `/generated/*` 미디어 경로를 서버 절대 URL 로 — 같은 origin 의 /generated/ 만 허용
/// (본문에 섞인 외부 URL 을 서버 자격증명 컨텍스트로 열지 않는다).
public enum GeneratedMediaURLResolver {
    public static func resolve(source: String, serverURL: URL) -> URL? {
        guard let resolved = URL(string: source, relativeTo: serverURL)?.absoluteURL,
              resolved.scheme?.lowercased() == serverURL.scheme?.lowercased(),
              resolved.host?.lowercased() == serverURL.host?.lowercased(),
              resolved.port == serverURL.port,
              resolved.path.hasPrefix("/generated/") else { return nil }
        return resolved
    }
}

/// 이전 이름 호환 — 이미지 전용으로 쓰이던 해석기
public enum GeneratedImageURLResolver {
    public static func resolve(source: String, serverURL: URL) -> URL? {
        GeneratedMediaURLResolver.resolve(source: source, serverURL: serverURL)
    }
}
