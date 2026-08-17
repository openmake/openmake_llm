// 마크다운 렌더러 — 서드파티 0 원칙: 코드펜스는 수동 분리, 인라인은 AttributedString(markdown:)
import SwiftUI
import UIKit
import OpenMakeKit

struct MarkdownText: View {
    let content: String

    private enum BlockSegment {
        case text(String)
        case code(language: String?, body: String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownContentParser.segments(in: content).enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .text(let text):
                    textBlocks(text)
                case .image(let alt, let source):
                    GeneratedImageView(alt: alt, source: source)
                }
            }
        }
    }

    @ViewBuilder
    private func textBlocks(_ text: String) -> some View {
        ForEach(Array(blocks(in: text).enumerated()), id: \.offset) { _, segment in
            switch segment {
            case .text(let text):
                RichTextBlock(text: text)
            case .code(let language, let body):
                CodeBlockView(language: language, code: body)
            }
        }
    }

    private func blocks(in text: String) -> [BlockSegment] {
        var result: [BlockSegment] = []
        var currentText: [String] = []
        var codeLines: [String] = []
        var codeLanguage: String?
        var inCode = false

        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix("```") {
                if inCode {
                    result.append(.code(language: codeLanguage, body: codeLines.joined(separator: "\n")))
                    codeLines = []
                    inCode = false
                } else {
                    let text = currentText.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { result.append(.text(text)) }
                    currentText = []
                    let lang = line.dropFirst(3).trimmingCharacters(in: .whitespaces)
                    codeLanguage = lang.isEmpty ? nil : lang
                    inCode = true
                }
            } else if inCode {
                codeLines.append(line)
            } else {
                currentText.append(line)
            }
        }
        if inCode {
            // 스트리밍 중 미완성 펜스 — 코드로 표시
            result.append(.code(language: codeLanguage, body: codeLines.joined(separator: "\n")))
        } else {
            let text = currentText.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { result.append(.text(text)) }
        }
        return result
    }

}

/// 블록 마크다운 렌더 — 헤딩·불릿/번호 리스트·인용·구분선을 실제 서식으로 표시한다.
/// (인라인 전용 렌더만 쓰면 "*   항목", "---", "## 제목" 이 raw 로 노출된다 — 2026-08-17 수정)
private struct RichTextBlock: View {
    let text: String

    private enum Line: Identifiable {
        case heading(level: Int, text: String)
        case bullet(text: String, depth: Int)
        case numbered(marker: String, text: String, depth: Int)
        case quote(text: String)
        case divider
        case paragraph(text: String)

        var id: String { String(describing: self) + UUID().uuidString }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(parse().enumerated()), id: \.offset) { _, line in
                switch line {
                case .heading(let level, let text):
                    Text(inline(text))
                        .font(.system(size: level <= 1 ? 20 : (level == 2 ? 17.5 : 16), weight: .bold))
                        .foregroundStyle(Lumen.fg)
                        .padding(.top, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                case .bullet(let text, let depth):
                    listRow(marker: "•", text: text, depth: depth)
                case .numbered(let marker, let text, let depth):
                    listRow(marker: marker, text: text, depth: depth)
                case .quote(let text):
                    HStack(alignment: .top, spacing: 8) {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Lumen.accent.opacity(0.5))
                            .frame(width: 3)
                        body(text).foregroundStyle(Lumen.fg2)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                case .divider:
                    Rectangle()
                        .fill(Lumen.border)
                        .frame(height: 1)
                        .padding(.vertical, 4)
                case .paragraph(let text):
                    body(text)
                }
            }
        }
    }

    private func listRow(marker: String, text: String, depth: Int) -> some View {
        HStack(alignment: .top, spacing: 7) {
            Text(marker)
                .font(.system(size: 15))
                .foregroundStyle(Lumen.muted)
                .frame(minWidth: marker == "•" ? 8 : 16, alignment: .leading)
            body(text)
        }
        .padding(.leading, CGFloat(depth) * 14)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func body(_ text: String) -> some View {
        Text(inline(text))
            .font(.system(size: 15))
            .lineSpacing(3)
            .foregroundStyle(Lumen.fg)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// 인라인(굵게/기울임/코드/링크)만 해석 — 블록은 위에서 이미 분해됨
    private func inline(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    /// 라인 단위 블록 분해 — 연속 문단은 하나로 합쳐 문단 간격을 유지한다.
    private func parse() -> [Line] {
        var result: [Line] = []
        var paragraph: [String] = []

        func flush() {
            let joined = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !joined.isEmpty { result.append(.paragraph(text: joined)) }
            paragraph = []
        }

        for rawLine in text.components(separatedBy: "\n") {
            let indent = rawLine.prefix { $0 == " " || $0 == "\t" }.count
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            let depth = min(indent / 2, 3)

            if line.isEmpty {
                flush()
                continue
            }
            // 구분선: ---, ***, ___ (3자 이상)
            if line.count >= 3, line.allSatisfy({ $0 == "-" }) || line.allSatisfy({ $0 == "*" }) || line.allSatisfy({ $0 == "_" }) {
                flush()
                result.append(.divider)
                continue
            }
            // 헤딩: # ~ ######
            if line.hasPrefix("#") {
                let hashes = line.prefix { $0 == "#" }.count
                if hashes <= 6, line.dropFirst(hashes).hasPrefix(" ") {
                    flush()
                    result.append(.heading(
                        level: hashes,
                        text: String(line.dropFirst(hashes)).trimmingCharacters(in: .whitespaces)))
                    continue
                }
            }
            // 인용: >
            if line.hasPrefix(">") {
                flush()
                result.append(.quote(text: String(line.dropFirst()).trimmingCharacters(in: .whitespaces)))
                continue
            }
            // 불릿: -, *, + (뒤에 공백 필수 — 굵게(**)와 구분)
            if let first = line.first, "-*+".contains(first), line.dropFirst().hasPrefix(" ") {
                flush()
                result.append(.bullet(
                    text: String(line.dropFirst()).trimmingCharacters(in: .whitespaces),
                    depth: depth))
                continue
            }
            // 번호 리스트: 1. / 1)
            if let match = line.firstMatch(of: /^(\d{1,3})[.)]\s+(.+)$/) {
                flush()
                result.append(.numbered(
                    marker: "\(match.1).",
                    text: String(match.2),
                    depth: depth))
                continue
            }
            paragraph.append(line)
        }
        flush()
        return result
    }
}

private struct GeneratedImageView: View {
    let alt: String
    let source: String

    var body: some View {
        AsyncImage(url: imageURL) { phase in
            switch phase {
            case .empty:
                RoundedRectangle(cornerRadius: 12)
                    .fill(Lumen.surface2)
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay { ProgressView().tint(Lumen.accent) }
            case .success(let image):
                image
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Lumen.border))
            case .failure:
                ContentUnavailableView(
                    "이미지를 불러오지 못했습니다",
                    systemImage: "photo.badge.exclamationmark",
                    description: Text(source))
                    .frame(minHeight: 160)
                    .background(Lumen.surface2, in: RoundedRectangle(cornerRadius: 12))
            @unknown default:
                EmptyView()
            }
        }
        .accessibilityLabel(alt.isEmpty ? "생성된 이미지" : alt)
    }

    private var imageURL: URL? {
        GeneratedImageURLResolver.resolve(source: source, serverURL: AppConfig.serverURL)
    }
}

struct CodeBlockView: View {
    let language: String?
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "code")
                    .font(.caption2)
                    .foregroundStyle(Lumen.muted)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption2)
                        .foregroundStyle(Lumen.muted)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("코드 복사")
            }
            .padding(.leading, 12)
            .background(Lumen.surface2)

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Lumen.fg2)
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Lumen.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Lumen.border))
    }
}
