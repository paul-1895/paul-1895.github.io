// ─── THEME ────────────────────────────────────────────────────────────────────
// The project's single source of truth for the light/dark preference:
// one localStorage key ('dse-theme') plus [data-theme] on <html>.
//
// The project used to carry two rival keys for the same preference —
// 'dse_theme' (tasks, trades, demo trade) and 'theme-preference' (newspaper,
// rgsnapshots) — each with its own inline copy of the logic below. They are
// gone; shared/display-settings.js folds any stored legacy value into
// 'dse-theme' once, in the <head> of every page, before this module runs, so
// there is deliberately no per-page migration here.
export const THEME_KEY = 'dse-theme';

export function toggleTheme(onThemeChange) {
  const html = document.documentElement;
  const isLight = html.getAttribute('data-theme') === 'light';
  const newTheme = isLight ? 'dark' : 'light';
  html.setAttribute('data-theme', newTheme);
  try { localStorage.setItem(THEME_KEY, newTheme); } catch (e) { /* private mode */ }
  updateThemeButton(newTheme);
  // Typeof-checked because several pages wire this up as
  // addEventListener('click', toggleTheme), which hands us a MouseEvent.
  if (typeof onThemeChange === 'function') {
    onThemeChange(newTheme);
  }
  return newTheme;
}

// The icon and label advertise the theme the button switches *to*. Not every
// header carries both spans — tasks and demo trade are icon-only — so both
// lookups are optional.
function updateThemeButton(theme) {
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
  if (label) label.textContent = theme === 'light' ? 'Dark' : 'Light';
}

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = (saved === 'light' || saved === 'dark')
    ? saved
    : (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeButton(theme);
  return theme;
}
