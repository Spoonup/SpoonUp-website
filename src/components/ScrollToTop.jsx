import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Router keeps scroll position across navigations; the design expects top-of-page. */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
