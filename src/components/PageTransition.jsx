import React from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Re-keys its subtree on every navigation so the entrance animation replays.
 * Cheap alternative to a full animation library for a fade-up on route change.
 */
export default function PageTransition({ children }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
