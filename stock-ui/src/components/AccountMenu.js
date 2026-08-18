/**
 * The account chip and its menu.
 *
 * There are no accounts and no sign-in: this app holds no session and calls no
 * auth backend. The menu is here so the shell reads as a complete product, and
 * it says so rather than pretending an action happened.
 */

import React, { useRef, useState } from 'react';

import { ChevronIcon } from './Icons';
import { DEMO_ACCOUNT } from '../mocks/demoData';

const MENU_ITEMS = ['Profile', 'Preferences', 'Billing', 'Sign out'];

/**
 * Render the account chip, opening a menu of items that do nothing.
 *
 * @returns {JSX.Element} The account control.
 */
export function AccountMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const handleBlur = (event) => {
    if (!containerRef.current?.contains(event.relatedTarget)) {
      setIsOpen(false);
    }
  };

  return (
    <div className="account" ref={containerRef} onBlur={handleBlur}>
      <button
        type="button"
        className="account__chip"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="account__avatar" aria-hidden="true">
          {DEMO_ACCOUNT.initials}
        </span>
        <span className="account__identity">
          <span className="account__name">{DEMO_ACCOUNT.name}</span>
          <span className="account__role">{DEMO_ACCOUNT.role}</span>
        </span>
        <ChevronIcon size={14} />
      </button>

      {isOpen && (
        <div className="account__menu" role="menu">
          {MENU_ITEMS.map((item) => (
            <button type="button" className="account__item" role="menuitem" key={item}>
              {item}
            </button>
          ))}
          <p className="account__note">
            Accounts are not part of this app. Nothing here signs you in or leaves the browser.
          </p>
        </div>
      )}
    </div>
  );
}
