/**
 * The kit's stylesheet, generated from the tokens so there is exactly one source of truth for a
 * colour (UX-00 section 16: "no hex literal outside the token file").
 *
 * `<ThemeProvider>` injects this once per document. Inline styles cover everything that is dynamic;
 * this file covers what inline styles cannot express: `:focus-visible` (RN Web strips it, UX-00
 * section 5.3), hover, `::placeholder`, keyframes, reduced motion and the print stylesheet.
 */
import { flattenColors, type SemanticColors } from '../tokens.js'

/** `bg.ground` -> `--dos-bg-ground`. */
export function cssVarName(token: string): string {
  return `--dos-${token.replace(/\./g, '-')}`
}

/** `var(--dos-bg-ground)`. */
export function cssVar(token: string): string {
  return `var(${cssVarName(token)})`
}

/** The custom properties for one theme, scoped to a selector. */
export function buildThemeVars(colors: SemanticColors, selector = ':root'): string {
  const flat = flattenColors(colors)
  const lines = Object.entries(flat).map(([token, value]) => `  ${cssVarName(token)}: ${value};`)
  return `${selector} {\n${lines.join('\n')}\n}`
}

/**
 * Structural rules. Every colour here is a custom property, so the same sheet serves both themes.
 * `dos-` prefixes every class; nothing here styles a bare element outside the kit's own scope.
 */
export const BASE_CSS = `
.dos-root {
  font-family: var(--dos-font-sans);
  color: var(--dos-text-primary);
  background: var(--dos-bg-ground);
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
.dos-root *, .dos-root *::before, .dos-root *::after { box-sizing: border-box; }
.dos-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }

/* Focus: 2 px ring, 2 px offset, 1 px surface halo (UX-00 5.3). Restored because RN Web strips it. */
.dos-root :focus { outline: none; }
.dos-root :focus-visible {
  outline: 2px solid var(--dos-focus-ring);
  outline-offset: 2px;
  border-radius: 6px;
}

/* Buttons -------------------------------------------------------------- */
.dos-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: 1px solid transparent; border-radius: 8px; cursor: pointer;
  font-family: inherit; font-variant-numeric: tabular-nums;
  transition: background-color 80ms cubic-bezier(0.2,0,0,1), transform 80ms cubic-bezier(0.2,0,0,1);
  text-align: center; white-space: nowrap; padding: 0 16px;
}
.dos-btn:active:not(:disabled) { transform: scale(0.98); }
.dos-btn-primary { background: var(--dos-accent-solid); color: var(--dos-text-onAccent); }
.dos-btn-primary:hover:not(:disabled) { background: var(--dos-accent-pressed); }
.dos-btn-secondary { background: var(--dos-bg-surface); color: var(--dos-text-primary); border-color: var(--dos-border-strong); }
.dos-btn-secondary:hover:not(:disabled) { background: var(--dos-bg-raised); }
.dos-btn-ghost { background: transparent; color: var(--dos-accent-fg); padding: 0 8px; }
.dos-btn-ghost:hover:not(:disabled) { background: var(--dos-accent-tint); }
.dos-btn-destructive { background: var(--dos-bg-surface); color: var(--dos-status-brick-fg); border-color: var(--dos-status-brick-edge); }
.dos-btn-destructive:hover:not(:disabled) { background: var(--dos-status-brick-tint); }
/* A disabled control is never greyed: surface fill, strong outline, 8.35:1 label, reason beneath. */
.dos-btn:disabled {
  cursor: not-allowed; background: var(--dos-bg-surface);
  color: var(--dos-text-disabled); border-color: var(--dos-border-strong);
}
.dos-btn-shortcut { font-size: 12px; opacity: 0.75; margin-left: 4px; }
.dos-btn-reason { color: var(--dos-text-secondary); font-size: 14px; line-height: 18px; margin-top: 4px; }

/* Inputs --------------------------------------------------------------- */
.dos-input {
  width: 100%; font-family: inherit; font-variant-numeric: tabular-nums;
  background: var(--dos-bg-surface); color: var(--dos-text-primary);
  border: 1px solid var(--dos-border-strong); border-radius: 6px; padding: 0 12px;
}
.dos-input::placeholder { color: var(--dos-text-secondary); opacity: 1; }
.dos-input:disabled { color: var(--dos-text-disabled); border-style: dashed; background: var(--dos-bg-surface); }
.dos-input[data-state='error'] { border-color: var(--dos-status-brick-edge); }
.dos-input[data-state='readonly'] { border-color: transparent; padding-left: 0; }

/* Rows and groups ------------------------------------------------------ */
.dos-row { display: flex; align-items: center; width: 100%; background: var(--dos-bg-surface); border: 0; text-align: left; font-family: inherit; cursor: default; }
.dos-row[data-pressable='true'] { cursor: pointer; }
.dos-row[data-pressable='true']:hover { background: var(--dos-bg-raised); }
.dos-row[data-state='selected'] { background: var(--dos-accent-tint); }

/* Register ------------------------------------------------------------- */
.dos-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.dos-table th { position: sticky; top: 0; z-index: 1; background: var(--dos-bg-surface); text-align: left; }
.dos-table tbody tr:hover { background: var(--dos-bg-raised); }
.dos-table tbody tr[aria-selected='true'] { background: var(--dos-accent-tint); }
.dos-table td, .dos-table th { padding: 0 12px; }

/* Skeleton ------------------------------------------------------------- */
@keyframes dos-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes dos-spin { to { transform: rotate(360deg); } }
.dos-skeleton { background: var(--dos-bg-skeleton); border-radius: 6px; animation: dos-pulse 1200ms ease-in-out infinite; }

/* Overlays ------------------------------------------------------------- */
.dos-backdrop { position: fixed; inset: 0; background: var(--dos-bg-backdrop); display: flex; z-index: 40; }
.dos-dialog { background: var(--dos-bg-surface); border-radius: 12px; box-shadow: 0 8px 32px rgba(27,30,26,0.16); max-width: 480px; width: 100%; }
.dos-sheet { background: var(--dos-bg-surface); border-radius: 20px 20px 0 0; box-shadow: 0 -2px 16px rgba(27,30,26,0.12); width: 100%; }
.dos-toast { background: var(--dos-bg-raised); border: 1px solid var(--dos-border-hairline); border-radius: 8px; }

@media (prefers-reduced-motion: reduce) {
  .dos-root *, .dos-root *::before, .dos-root *::after {
    animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

@media print {
  .dos-no-print { display: none !important; }
  .dos-root { background: #FFFFFF; }
  .dos-table { font-size: 11pt; }
  .dos-table thead { display: table-header-group; }
}
`

/**
 * IBM Plex Sans, self-hosted (founder, 2026-09-05). The app serves the binaries from
 * `public/fonts`; until they are installed the stack falls back to the platform UI face at the same
 * sizes, so nothing shifts except the letterforms.
 */
export const FONT_CSS = `
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('/fonts/IBMPlexSans-Variable.woff2') format('woff2-variations');
  font-weight: 400 700;
  font-style: normal;
  font-display: swap;
}
`

/**
 * The complete sheet for one theme.
 *
 * The page itself is painted here as well: the host paints its own ground behind the document, so a
 * transparent `<html>` borrows whatever the browser or the viewer's appearance setting decides, and
 * the warm paper ground of direction A would be lost outside the app's own box.
 */
export function buildStylesheet(
  colors: SemanticColors,
  fontSans: string,
  scheme: 'light' | 'dark' = 'light',
): string {
  return [
    FONT_CSS,
    `html { background: ${colors.bg.ground}; color-scheme: ${scheme}; }`,
    `html, body { margin: 0; }`,
    buildThemeVars(colors, '.dos-root'),
    `.dos-root { --dos-font-sans: ${fontSans}; }`,
    BASE_CSS,
  ].join('\n')
}
