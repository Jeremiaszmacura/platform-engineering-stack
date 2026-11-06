/** Chart colours (canvas can't use CSS variables); keep in sync with styles/theme.css. */

/** Chart colours per theme, keyed by the values of `THEMES`. */
export const PALETTES = {
  dark: {
    surface: '#101215',
    text: '#f3f5f6',
    muted: '#8c949c',
    border: '#2f343b',
    grid: 'rgba(255, 255, 255, 0.045)',
    accent: '#4ade80',
    accentFill: 'rgba(74, 222, 128, 0.26)',
    accentInk: '#05130a',
    up: '#4ade80',
    down: '#f4585f',
  },
  light: {
    surface: '#ffffff',
    text: '#0c0e11',
    muted: '#5c666f',
    border: '#ccd4db',
    grid: 'rgba(12, 14, 17, 0.06)',
    accent: '#12a150',
    accentFill: 'rgba(18, 161, 80, 0.2)',
    accentInk: '#ffffff',
    up: '#12a150',
    down: '#d92d3a',
  },
};
