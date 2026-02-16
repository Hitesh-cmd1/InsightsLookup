import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  trackSessionStarted,
  trackAppOpened,
  trackSessionEnded,
  trackPageViewed,
} from './mixpanel';

const ROUTE_PAGE_NAMES = {
  '/': 'Landing',
  '/dashboard': 'Dashboard',
  '/company-details': 'Company Details',
};

function getPageName(pathname) {
  return ROUTE_PAGE_NAMES[pathname] || pathname || 'Unknown';
}

/**
 * Tracks session start, app opened, page views (with time_event for time spent), and session end.
 * Must be rendered inside BrowserRouter.
 */
export function AnalyticsTracker() {
  const location = useLocation();
  const isFirstMount = useRef(true);

  // Session Started + App Opened on first load
  useEffect(() => {
    trackSessionStarted();
    trackAppOpened();
  }, []);

  // Session Ended when user leaves
  useEffect(() => {
    const handleEnd = () => trackSessionEnded();
    window.addEventListener('beforeunload', handleEnd);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleEnd();
    });
    return () => {
      window.removeEventListener('beforeunload', handleEnd);
      document.removeEventListener('visibilitychange', handleEnd);
    };
  }, []);

  // Page Viewed on route change (time_event before track for time-on-page)
  useEffect(() => {
    const pageName = getPageName(location.pathname);
    const urlPath = location.pathname + (location.search || '');

    if (isFirstMount.current) {
      isFirstMount.current = false;
      trackPageViewed(pageName, urlPath);
      return;
    }
    trackPageViewed(pageName, urlPath);
  }, [location.pathname, location.search]);

  return null;
}
