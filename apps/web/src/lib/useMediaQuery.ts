import { useEffect, useState } from 'react';

/**
 * Tracks a CSS media query in React.
 *
 * Used where rendering both layouts and hiding one with CSS would duplicate the
 * DOM (and therefore accessible names) — for example the transaction table and
 * its mobile card list. Rendering only the active layout keeps screen readers
 * and tests unambiguous.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return fallback;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
