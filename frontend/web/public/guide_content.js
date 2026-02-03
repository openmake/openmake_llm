/**
 * @file guide_content.js
 * @description LLM 사용자 가이드의 동적 콘텐츠 데이터
 * 기능 변경 시 이 파일의 내용을 수정하여 매뉴얼을 최신화하십시오.
 */

const GUIDE_DATA = {
    title: "OpenMake.Ai 사용자 가이드",
    version: "1.2",
    sections: [
        {
            id: "auto_detect",
            title: "🎯 자동 프롬프트 감지",
            description: "사용자의 질문 의도를 분석하여 최적의 모드를 자동으로 선택합니다.",
            items: [
                { icon: "✍️", label: "글쓰기", example: '"이메일 초안 작성해줘"', mode: "writer" },
                { icon: "🌐", label: "번역", example: '"Hello를 한국어로?"', mode: "translator" },
                { icon: "🔍", label: "분석/보안", example: '"코드 보안 검토해줘"', mode: "reviewer" },
                { icon: "💡", label: "컨설팅", example: '"비즈니스 전략 세워줘"', mode: "consultant" },
                { icon: "💬", label: "일반 대화", example: '"오늘 날씨 어때?"', mode: "assistant" }
            ]
        },
        {
            id: "commands",
            title: "⌨️ 유용한 명령어",
            description: "채팅창에 입력하여 기능을 제어할 수 있습니다.",
            items: [
                { cmd: "/help", desc: "이 도움말 모달을 표시합니다." },
                { cmd: "/clear", desc: "현재 대화 내용을 초기화합니다." },
                { cmd: "/mode [타입]", desc: "특정 프롬프트 모드로 강제 전환합니다." }
            ]
        },
        {
            id: "prompt_modes",
            title: "🔧 프롬프트 모드 안내",
            description: "각 모드는 특정 작업에 최적화된 프롬프트를 사용합니다.",
            modes: [
                "assistant", "reasoning", "coder", "reviewer", "explainer",
                "generator", "writer", "researcher", "translator",
                "consultant", "security", "agent"
            ]
        }
    ],
    footer: "OpenMake.Ai은 지속적으로 업데이트됩니다. 새로운 기능은 이 가이드에서 확인하실 수 있습니다."
};

if (typeof module !== 'undefined') {
    module.exports = GUIDE_DATA;
}
