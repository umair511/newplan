import { ThemeId, THEME_OPTIONS } from '../types/theme';

const THEME_STORAGE_KEY = 'plannex_active_theme';

export function getStoredTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    if (saved && THEME_OPTIONS.some(t => t.id === saved)) {
      return saved;
    }
  } catch (e) {
    console.error('Failed to load stored theme', e);
  }
  return 'gemini';
}

export function saveStoredTheme(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyThemeToDocument(theme);
  } catch (e) {
    console.error('Failed to save stored theme', e);
  }
}

export function applyThemeToDocument(theme: ThemeId): void {
  const root = document.documentElement;
  const body = document.body;

  // Remove any existing theme-* classes
  const allThemeClasses = THEME_OPTIONS.map(t => `theme-${t.id}`);
  root.classList.remove(...allThemeClasses);
  body.classList.remove(...allThemeClasses);

  // Add new theme class
  const themeClass = `theme-${theme}`;
  root.classList.add(themeClass);
  body.classList.add(themeClass);
  root.setAttribute('data-theme', theme);
}
