import Foundation

/// 에이전트 작업 스텝을 화면에 보여줄 형태로 다듬는다.
///
/// 서버는 스텝 content 를 실행 원문 그대로 저장한다 — 아티팩트는 JSON 직렬화본,
/// git_diff 는 unified diff 전문, 어시스턴트 답변은 `[[artifact:id]]` placeholder 포함.
/// 앱이 이를 그대로 뿌리면 사용자에게 의미 없는 raw 텍스트가 보인다(2026-08-18 실기기 확인).
public enum AgentTaskStepPresenter {
    /// 스텝 헤더에 쓸 이름 — 도구명이 있으면 도구명, 없으면 스텝 종류의 한국어 라벨.
    public static func label(stepType: String, toolName: String?) -> String {
        if let toolName, !toolName.isEmpty { return toolName }
        switch stepType {
        case "plan": return "계획"
        case "assistant": return "답변"
        case "assistant_tool_call": return "도구 호출"
        case "tool_result": return "도구 결과"
        case "artifact": return "산출물"
        case "diff": return "변경 사항"
        case "retry": return "재시도"
        case "hitl_degrade": return "승인 대기 정리"
        default: return stepType
        }
    }

    /// 스텝 본문 — 종류별로 요약하고, 남는 placeholder 는 걷어낸다.
    public static func body(stepType: String, toolName: String?, content: String?) -> String? {
        guard let content, !content.isEmpty else { return nil }
        let summarized: String
        switch stepType {
        case "artifact":
            summarized = artifactSummary(content) ?? content
        case "diff":
            summarized = diffSummary(content) ?? content
        default:
            summarized = content
        }
        let cleaned = MarkdownContentParser.strippingArtifactPlaceholders(summarized)
        return cleaned.isEmpty ? nil : cleaned
    }

    /// 아티팩트 스텝의 JSON 직렬화본 → "제목 · kind(lang)"
    static func artifactSummary(_ content: String) -> String? {
        guard let data = content.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let title = (object["title"] as? String) ?? (object["id"] as? String)
        guard let title, !title.isEmpty else { return nil }
        let kind = (object["kind"] as? String) ?? "artifact"
        if let lang = object["lang"] as? String, !lang.isEmpty {
            return "\(title) · \(kind)(\(lang))"
        }
        return "\(title) · \(kind)"
    }

    /// unified diff → 변경 파일 목록. 전문을 카드에 흘리지 않는다.
    static func diffSummary(_ content: String) -> String? {
        var files: [String] = []
        for line in content.components(separatedBy: "\n") where line.hasPrefix("diff --git ") {
            // "diff --git a/x b/x" 의 b/ 경로를 파일명으로 쓴다
            guard let path = line.components(separatedBy: " ").last,
                  path.hasPrefix("b/") else { continue }
            let name = String(path.dropFirst(2))
            if !name.isEmpty, !files.contains(name) { files.append(name) }
        }
        guard !files.isEmpty else { return nil }
        let shown = files.prefix(5).joined(separator: ", ")
        return files.count > 5 ? "변경 파일 \(files.count)개: \(shown) 외" : "변경 파일: \(shown)"
    }
}
