# OpenMake iOS Design System — LUMEN

## 1. Product identity

OpenMake iOS is the native companion for conversations, autonomous agent work, deep research, generated images, and reusable artifacts. The product should feel calm while work is in progress and precise when results arrive. The visual signature is the LUMEN dot: one small point of light that communicates model presence and activity without turning the interface into a dashboard.

## 2. Design principles

1. **Result first.** Put the user's content and finished output ahead of controls or telemetry.
2. **One clear activity line.** While the system is working, show one short, truthful status such as “자료를 찾고 있어요”. Never expose private chain-of-thought or stack multiple spinners.
3. **Progressive disclosure.** Keep advanced modes in the composer and drawer; reveal steps, artifacts, and task detail only when requested.
4. **Native confidence.** Prefer SwiftUI navigation, system symbols, Dynamic Type, sheets, and platform gestures over web-shaped chrome.
5. **Durable work.** Agent tasks and research continue independently from the current screen and are recoverable from the drawer.

## 3. Color tokens

All runtime colors are defined in `OpenMakeApp/App/Theme.swift` and must support light and dark appearances.

| Token | Light | Dark | Use |
|---|---:|---:|---|
| `Lumen.bg` | `#F7F8FA` | `#0E1014` | App background |
| `Lumen.surface` | `#FFFFFF` | `#15181E` | Cards and inputs |
| `Lumen.surface2` | `#F1F3F6` | `#1B1F27` | Secondary controls and user messages |
| `Lumen.surface3` | `#E9ECF1` | `#222732` | Disabled and tertiary controls |
| `Lumen.fg` | `#14161C` | `#ECEEF2` | Primary text |
| `Lumen.fg2` | `#3A3F4A` | `#C3C9D2` | Secondary text |
| `Lumen.muted` | `#626B7A` | `#97A0AE` | Metadata |
| `Lumen.faint` | `#8A93A1` | `#6B7480` | Disabled content |
| `Lumen.border` | `#E4E7EC` | `#262B34` | Hairline borders |
| `Lumen.accent` | `#2F6BFF` | `#5B8CFF` | Primary actions and active state |
| `Lumen.accentSoft` | `#EAF1FF` | `#182134` | Selected chips and quiet emphasis |
| `Lumen.success` | `#149A6B` | `#3FBD8C` | Completed states |
| `Lumen.warn` | `#B5730A` | `#E0A040` | Thinking, paused, and attention states |

System red is reserved for destructive actions and errors.

## 4. Typography and iconography

- Use San Francisco through SwiftUI system fonts. Body copy is 15 pt at the default content-size category; metadata is 11–12 pt; screen titles use the native navigation title scale.
- Respect Dynamic Type for user-facing copy. Fixed-size typography is permitted only for compact labels when the surrounding control remains readable at accessibility sizes.
- Use monospaced system text for code and machine identifiers.
- Use SF Symbols for every visible icon. Do not use emoji as product icons or attachment labels.
- The `Wordmark` uses heavy system weight and the accent only on “Make”.

## 5. Spacing, shape, and layout

- Base spacing unit: 4 pt. Common gaps are 4, 8, 12, 16, and 24 pt.
- Minimum interactive target: 44 × 44 pt, even when the visible glyph is smaller.
- Message and content corners: 10–18 pt. Composer radius: 22 pt. Mode and attachment labels use capsules.
- Primary screens are edge-to-edge on `Lumen.bg`; content cards use `Lumen.surface` with a one-pixel `Lumen.border` stroke.
- The drawer is at most 86% of compact-screen width and leaves a scrim that dismisses with tap or drag.

## 6. Reusable primitives

### Brand primitives

- `Wordmark`: product title in navigation and drawer header.
- `LumenDot`: semantic presence dot. Pulse only while work is active and honor Reduce Motion.

### Work primitives

- `ActivityStatusLine`: exactly one short line with a pulsing dot. States: preparing, agent, tool, research, artifact, finalizing, paused, and error. New activity replaces the previous line.
- `ModeChip`: active composer mode with symbol, label, accent-soft background, and an accessibility value of “켜짐”.
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
- **Streaming:** show the assistant header, current status until the first answer token, then the partial answer. The status line must disappear when output begins.
- **Completed:** stop motion, use success color only for a durable completion label, and surface artifacts next to the response that produced them.
- **Paused:** use warning color and show the approval or resume action.
- **Failed:** show a plain-language error and retry/resume only when the server state supports it.
- **Offline:** preserve already-loaded content and explain that refresh or execution requires a connection.

## 8. Accessibility, motion, and content rules

- Every icon-only button has an accessibility label. Decorative dots are hidden from VoiceOver; status text carries the semantic announcement.
- Important status changes use polite live announcements and never repeat on every token.
- Honor Reduce Motion: replace dot scaling with a static dot and avoid automatic drawer or progress animations.
- Maintain readable contrast in both appearances; never encode task state by color alone.
- Generated images include server-provided alt text or the fallback “생성된 이미지”.
- Links and code remain selectable. External links open through the system URL environment.
- Hidden chain-of-thought is never displayed. Status copy describes observable work only, in one concise Korean line.
