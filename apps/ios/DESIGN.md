# OpenMake iOS Design System — Instrument (계측)

> 2026-09-05 Lumen → **Instrument** 전환. 토큰·서체는 웹 `apps/web/app/globals.css` 와 동일 값이며 기준안은 `OpenMake Color & Type Pairings.html` (PR #746).

## 1. Product identity

OpenMake iOS is the native companion for conversations, autonomous agent work, deep research, generated images, and reusable artifacts. The product should feel calm while work is in progress and precise when results arrive. The visual signature is the model dot (`LumenDot`): one small point of light that communicates model presence and activity without turning the interface into a dashboard.

## 2. Design principles

1. **Result first.** Put the user's content and finished output ahead of controls or telemetry.
2. **One clear activity line.** While the system is working, show one short, truthful status such as “자료를 찾고 있어요”. Never expose private chain-of-thought or stack multiple spinners.
3. **Progressive disclosure.** Keep advanced modes in the composer and drawer; reveal steps, artifacts, and task detail only when requested.
4. **Native confidence.** Prefer SwiftUI navigation, system symbols, Dynamic Type, sheets, and platform gestures over web-shaped chrome.
5. **Durable work.** Agent tasks and research continue independently from the current screen and are recoverable from the drawer.

## 3. Color tokens

All runtime colors are defined in `OpenMakeApp/App/Theme.swift` (`enum Instrument`) and must support light and dark appearances. Values mirror the web `:root` / `[data-theme="dark"]` tokens.

| Token | Light | Dark | Use |
|---|---:|---:|---|
| `Instrument.bg` | `#F7F8FA` | `#0D0F13` | App background |
| `Instrument.surface` | `#FFFFFF` | `#12151A` | Cards and inputs |
| `Instrument.surface2` | `#EEF1F5` | `#191D24` | Secondary controls and user messages |
| `Instrument.surface3` | `#E8EBF0` | `#20252E` | Disabled and tertiary controls |
| `Instrument.fg` | `#14161A` | `#E7EAEF` | Primary text (dark never pure white) |
| `Instrument.fg2` | `#3B424C` | `#B5BCC7` | Secondary text |
| `Instrument.muted` | `#5C6470` | `#8B93A0` | Metadata, smallest readable text |
| `Instrument.faint` | `#949BA6` | `#616977` | Decorative icons and disabled glyphs only — **never text** (2.7:1) |
| `Instrument.border` | `#E1E4EA` | `#262B33` | Hairline borders |
| `Instrument.borderStrong` | `#D5D9E0` | `#343A45` | Emphasised borders |
| `Instrument.accent` | `#1F4FD8` | `#5B84FF` | Primary actions and active state |
| `Instrument.accentSoft` | `#E9EEFB` | `#5B84FF @14%` | Selected chips and quiet emphasis |
| `Instrument.second` | `#00A3B4` | `#2FD4E4` | Secondary brand accent (code, mono highlights) |
| `Instrument.secondSoft` | `#E0F5F8` | `#2FD4E4 @14%` | Quiet secondary emphasis |
| `Instrument.success` | `#149A6B` | `#3FBD8C` | Completed states |
| `Instrument.warn` | `#B5730A` | `#E0A040` | Thinking, paused, and attention states |
| `Instrument.danger` | `#D5392F` | `#F1685E` | Destructive actions and errors |

## 4. Typography and iconography

- Three families, same as the web: **Space Grotesk** for headings, wordmark and Latin display (`Instrument.display(size:weight:)`, tracking `-0.03em` via `Instrument.headingTracking`), the **system font** for body copy (Noto Sans KR is not bundled — several MB per weight; the system Korean face keeps Dynamic Type), and **IBM Plex Mono** for numbers, paths and code (`Instrument.mono(size:)`).
- Bundled fonts live in `OpenMakeApp/Resources/Fonts/` (OFL licences alongside) and are registered in `Info.plist` `UIAppFonts`.
- Body copy is 15 pt at the default content-size category; metadata is 11–12 pt; screen titles use the native navigation title scale.
- Respect Dynamic Type for user-facing copy. Fixed-size typography is permitted only for compact labels when the surrounding control remains readable at accessibility sizes.
- Use SF Symbols for every visible icon. Do not use emoji as product icons or attachment labels.
- The `Wordmark` uses Space Grotesk bold and the accent only on “Make”.

## 5. Spacing, shape, and layout

- Base spacing unit: 4 pt. Common gaps are 4, 8, 12, 16, and 24 pt.
- Minimum interactive target: 44 × 44 pt, even when the visible glyph is smaller.
- Message and content corners: 10–18 pt. Composer radius: 22 pt. Mode and attachment labels use capsules.
- Primary screens are edge-to-edge on `Instrument.bg`; content cards use `Instrument.surface` with a one-pixel `Instrument.border` stroke.
- The drawer is at most 86% of compact-screen width and leaves a scrim that dismisses with tap or drag.

## 6. Reusable primitives

### Brand primitives

- `Wordmark`: product title in navigation and drawer header.
- `LumenDot`: semantic presence dot. Pulse only while work is active and honor Reduce Motion.

### Work primitives

- `ActivityStatusLine`: exactly one short line with a pulsing dot. States: preparing, agent, tool, research, artifact, finalizing, paused, and error. New activity replaces the previous line.
- `ModeChip`: active composer mode with symbol, label, accent-soft background, and an accessibility value of “켜짐”.
- `SkillChip`: a non-interactive label for a skill selected for the current question, using the `sparkles` symbol and secondary surface colors.
- `ActiveSkillBar`: a horizontally scrollable row of `SkillChip` values above the composer. It resets when a new question is sent and remains visible after streaming completes until the next question.
- `AgentTaskCard`: goal, status, progress, current/max turn, latest step, and relevant action. Completed cards reveal the result; failed cards reveal the error.
- `ArtifactCard`: kind symbol, title, language/kind metadata, and open action. Streaming artifacts show a progress state without presenting partial HTML as executable content.

### Navigation primitives

- `LumenDrawer`: profile summary, new conversation, agent tasks, deep research shortcut, conversations, and settings.
- `DrawerRow`: SF Symbol, title, optional badge, full-row tap target, selected tint.

### Content primitives

- `MarkdownText`: text, fenced code, links, and generated images. Relative image URLs resolve against the configured OpenMake server.
- `ArtifactViewer`: Markdown/code text selection and copy; HTML/SVG in an isolated `WKWebView`; unsupported interactive kinds fall back to source display.

## 7. Component states and behavior

- **Empty:** explain the next action in one sentence and provide a direct primary action where useful.
- **Loading:** retain navigation and show a single `ActivityStatusLine`; do not replace the entire screen unless no prior content exists.
- **Streaming:** show the assistant header, current status until the first answer token, then the partial answer. When skills are activated, the status names them with “적용 중” and `ActiveSkillBar` keeps the same context visible after output begins. The status line must disappear when output begins.
- **Completed:** stop motion, use success color only for a durable completion label, and surface artifacts next to the response that produced them.
- **Paused:** use warning color and show the approval or resume action.
- **Failed:** show a plain-language error and retry/resume only when the server state supports it.
- **Offline:** preserve already-loaded content and explain that refresh or execution requires a connection.

## 8. Accessibility, motion, and content rules

- Every icon-only button has an accessibility label. Decorative dots are hidden from VoiceOver; status text carries the semantic announcement.
- Skill chips announce “사용 스킬” followed by the skill name; the horizontal bar remains readable without requiring interaction.
- Important status changes use polite live announcements and never repeat on every token.
- Honor Reduce Motion: replace dot scaling with a static dot and avoid automatic drawer or progress animations.
- Maintain readable contrast in both appearances; never encode task state by color alone.
- Generated images include server-provided alt text or the fallback “생성된 이미지”.
- Links and code remain selectable. External links open through the system URL environment.
- Hidden chain-of-thought is never displayed. Status copy describes observable work only, in one concise Korean line.
