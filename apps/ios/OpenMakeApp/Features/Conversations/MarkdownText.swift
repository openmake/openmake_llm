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
                Text(inlineAttributed(text))
                    .font(.system(size: 15))
                    .lineSpacing(3)
                    .foregroundStyle(Lumen.fg)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
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

    private func inlineAttributed(_ text: String) -> AttributedString {
        // 문단 유지 + 인라인(굵게/기울임/코드/링크)만 해석 — 블록 문법(헤딩·리스트)은 원문 유지
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
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
