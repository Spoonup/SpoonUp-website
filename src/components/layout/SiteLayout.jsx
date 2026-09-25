import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import PageTransition from '../PageTransition';

/** Full chrome wrapper for every customer-facing page. */
export default function SiteLayout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-paper">
      {/* Design: logo is 46px, stepping up to 52px on Home. */}
      <SiteHeader tall={pathname === '/'} />
      <main className="flex-1">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>
      <SiteFooter />
    </div>
  );
}
