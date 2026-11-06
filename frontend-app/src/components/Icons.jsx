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

/** A traffic pulse, the brand mark: stock-ui charts prices, this app sends load. */
export const MarkIcon = (props) => (
  <Icon {...props}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
  </Icon>
);
