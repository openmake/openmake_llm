<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# frontend/web/public/css

## Purpose
Global stylesheet layer implementing the "Neo Brutalism 2.0" design system. All visual styling flows from CSS custom properties defined in `design-tokens.css`. Page-specific overrides live in the `pages/` subdirectory. No CSS preprocessors (Sass/Less) are used — all files are plain CSS served directly.

## Key Files
| File | Description |
|------|-------------|
| `design-tokens.css` | Single source of truth for all CSS custom properties: colors, spacing, typography, radius, shadows, z-index, and animation durations. All other CSS files must consume tokens from here. |
| `layout.css` | Page scaffolding: grid/flex layout for sidebar + main content area, responsive breakpoints. |
| `components.css` | Reusable component styles: buttons, cards, inputs, modals, badges, and other shared UI primitives. |
| `animations.css` | Keyframe animations and transition utility classes used across the UI. |
| `dark-sidebar.css` | Dark variant styles for the sidebar component, applied when the dark sidebar mode is active. |
| `light-theme.css` | Light theme overrides that reassign design token values for the light color scheme. |
| `unified-sidebar.css` | Styles for the 3-state Gemini-style unified sidebar component. |
| `icons.css` | Icon font or SVG icon utility classes. |
| `settings.css` | Styles scoped to the settings page UI. |
| `skill-library.css` | Styles for the skill library page. |
| `feature-cards.css` | Styles for feature card components used in onboarding and feature discovery. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `pages/` | Page-scoped CSS overrides that extend the global design system for specific page layouts |

## For AI Agents
### Working In This Directory
- **Never hardcode color, spacing, or typography values** — always use CSS custom properties from `design-tokens.css`.
- To add a new token, define it in `design-tokens.css` under the appropriate section, then reference it in component files.
- Light theme overrides belong in `light-theme.css` by reassigning token values under a `.light-theme` selector or `[data-theme="light"]`.
- Do not use `!important` except to override third-party vendor styles.
- All new component styles belong in `components.css` unless they are page-specific, in which case add a file to `pages/`.

### Testing Requirements
- Visually verify changes in both dark (default) and light themes.
- Check responsive behavior at mobile (375px), tablet (768px), and desktop (1280px) breakpoints.
- E2E tests in `tests/e2e/` will catch gross layout regressions.

### Common Patterns
- Design tokens follow the naming convention `--color-{role}-{variant}`, `--space-{size}`, `--radius-{size}`.
- Component classes use BEM-like naming: `.component-name`, `.component-name__element`, `.component-name--modifier`.
- Animations reference duration tokens: `var(--duration-fast)`, `var(--duration-normal)`.

## Dependencies
### Internal
- `public/index.html` — imports these CSS files in order; import order matters for cascade.
- `public/js/components/unified-sidebar.js` — references class names from `unified-sidebar.css`.

### External
- None — plain CSS with no preprocessor or framework dependencies.

<!-- MANUAL: -->
