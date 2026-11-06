/**
 * The icon set, inline so the app ships no icon font and makes no network
 * request for its own chrome. Every icon inherits `currentColor` and is hidden
 * from assistive technology — the control around it carries the label.
 */

import React from 'react';

/**
 * Shared frame for every icon: a 24-unit square stroked in the current colour.
 *
 * @param {Object} props Component props.
 * @param {number} [props.size] Rendered edge length in pixels.
 * @param {React.ReactNode} props.children Path elements of the icon.
 * @returns {JSX.Element} The icon.
 */
function Icon({ size = 18, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Magnifying glass, marking the search field. */
export const SearchIcon = (props) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);

/** Sun, shown while the dark theme is active to offer the light one. */
export const SunIcon = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </Icon>
);

/** Moon, shown while the light theme is active to offer the dark one. */
export const MoonIcon = (props) => (
  <Icon {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Icon>
);

/** Chevron, marking a control that opens a menu. */
export const ChevronIcon = (props) => (
  <Icon {...props}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

/** Stacked lines, opening the navigation drawer on narrow screens. */
export const MenuIcon = (props) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

/** Plus, zooming the chart in. */
export const PlusIcon = (props) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** Minus, zooming the chart out. */
export const MinusIcon = (props) => (
  <Icon {...props}>
    <path d="M5 12h14" />
  </Icon>
);

/** Arrows to the corners, fitting the whole range back on screen. */
export const FitIcon = (props) => (
  <Icon {...props}>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </Icon>
);

/** Rising bars, the brand mark. */
export const MarkIcon = (props) => (
  <Icon {...props}>
    <path d="M4 18V13M10 18V8M16 18v-7M22 18V5" />
  </Icon>
);
