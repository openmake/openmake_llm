// 마크다운 렌더러 — 서드파티 0 원칙: 코드펜스는 수동 분리, 인라인은 AttributedString(markdown:)
import SwiftUI
import UIKit

struct MarkdownText: View {
    let content: String

    private enum Segment {
        case text(String)
        case code(language: String?, body: String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                switch segment {
                case .text(let text):
                    Text(inlineAttributed(text))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                case .code(let language, let body):
                    CodeBlockView(language: language, code: body)
                }
            }
        }
    }

    /// ``` 펜스 기준 텍스트/코드 분리
    private var segments: [Segment] {
        var result: [Segment] = []
        var currentText: [String] = []
        var codeLines: [String] = []
        var codeLanguage: String?
        var inCode = false

        for line in content.components(separatedBy: "\n") {
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

struct CodeBlockView: View {
    let language: String?
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "code")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    UIPasteboard.general.string = code
                } label: {
                    Image(systemName: "doc.on.doc")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.fill.quaternary)

            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(.fill.quinary)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator.opacity(0.5)))
    }
}
