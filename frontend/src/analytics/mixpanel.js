/**
 * Mixpanel analytics for Insights Lookup.
 * Centralized event tracking: identity, sessions, pages, funnel, and product usage.
 */

import mixpanel from 'mixpanel-browser';

const MIXPANEL_TOKEN =
  process.env.REACT_APP_MIXPANEL_TOKEN || '29b61feb2990595f565b2ff83078b5f3';

const SESSION_START_KEY = 'insights_analytics_session_start';
const APP_OPENED_KEY = 'insights_analytics_app_opened';
const LAST_PAGE_KEY = 'insights_analytics_last_page';

let isInitialized = false;

/**
 * Initialize Mixpanel at app root.
 * Enable autocapture and session recording.
 */
export function initMixpanel() {
  if (isInitialized) return;
  mixpanel.init(MIXPANEL_TOKEN, {
    autocapture: true,
    record_sessions_percent: 100,
  });
  isInitialized = true;
}

function getMixpanel() {
  if (!isInitialized) initMixpanel();
  return mixpanel;
}

function getDeviceType() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// 2. User Identity
// ---------------------------------------------------------------------------

/**
 * Identify user after signup or login.
 * EVENT: Identify User (Mixpanel identify + people set)
 */
export function identifyUser(user, options = {}) {
  if (!user) return;
  const mp = getMixpanel();
  mp.identify(String(user.id));
  mp.people.set({
    email: user.email,
    $created: options.created_at || new Date().toISOString(),
    $name: user.name,
  });
}

// ---------------------------------------------------------------------------
// 3. Session Tracking
// ---------------------------------------------------------------------------

/**
 * Call when app loads.
 * EVENT: Session Started
 */
export function trackSessionStarted() {
  const start = Date.now();
  try {
    sessionStorage.setItem(SESSION_START_KEY, String(start));
  } catch (_) {}
  getMixpanel().track('Session Started', {
    timestamp: new Date().toISOString(),
    device_type: getDeviceType(),
    referrer: typeof document !== 'undefined' ? document.referrer || '' : '',
  });
}

/**
 * Call when user leaves the app (beforeunload / visibility hidden).
 * EVENT: Session Ended (includes activation counts for the session)
 */
export function trackSessionEnded() {
  const mp = getMixpanel();
  let sessionDurationSeconds = null;
  try {
    const start = sessionStorage.getItem(SESSION_START_KEY);
    if (start) {
      sessionDurationSeconds = Math.round((Date.now() - Number(start)) / 1000);
    }
  } catch (_) {}
  const lastPage = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(LAST_PAGE_KEY) : null;
  const activationCounts = getActivationCountsForSession();
  mp.track('Session Ended', {
    session_duration_seconds: sessionDurationSeconds,
    last_page: lastPage || undefined,
    ...activationCounts,
  });
}

// ---------------------------------------------------------------------------
// 4. Page Analytics
// ---------------------------------------------------------------------------

/**
 * Call on every route/page change.
 * Use time_event() before tracking so Mixpanel can compute time spent on previous page.
 * EVENT: Page Viewed
 */
export function trackPageViewed(pageName, urlPath) {
  const mp = getMixpanel();
  mp.time_event('Page Viewed');
  mp.track('Page Viewed', {
    page_name: pageName,
    url_path: urlPath || (typeof window !== 'undefined' ? window.location.pathname : ''),
    timestamp: new Date().toISOString(),
  });
  try {
    sessionStorage.setItem(LAST_PAGE_KEY, pageName || urlPath || '');
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// 5. Core Funnel
// ---------------------------------------------------------------------------

/**
 * First app load in a session.
 * EVENT: App Opened
 */
export function trackAppOpened() {
  try {
    if (sessionStorage.getItem(APP_OPENED_KEY)) return;
    sessionStorage.setItem(APP_OPENED_KEY, '1');
  } catch (_) {
    return;
  }
  getMixpanel().track('App Opened', {
    timestamp: new Date().toISOString(),
  });
}

/**
 * User successfully created account.
 * EVENT: Signup Completed
 */
export function trackSignupCompleted(signupMethod = 'email') {
  getMixpanel().track('Signup Completed', {
    signup_method: signupMethod,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Successful login.
 * EVENT: Login
 */
export function trackLogin() {
  getMixpanel().track('Login', {
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// 6. Product Value (Core Feature Used + Activation)
// ---------------------------------------------------------------------------

/**
 * User performed a main product action.
 * EVENT: Core Feature Used
 */
export function trackCoreFeatureUsed(featureName, context = {}) {
  getMixpanel().track('Core Feature Used', {
    feature_name: featureName,
    context: typeof context === 'object' ? context : { value: context },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Activation metrics for the current session.
 * EVENT: Activated
 */
export function trackActivated(properties) {
  getMixpanel().track('Activated', {
    ...properties,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Activation session counters (for Activated event properties)
// ---------------------------------------------------------------------------

const ACTIVATION_STORAGE_KEY = 'insights_activation_counts';

function getActivationCounts() {
  try {
    const raw = sessionStorage.getItem(ACTIVATION_STORAGE_KEY);
    return raw ? { ...JSON.parse(raw) } : {};
  } catch (_) {
    return {};
  }
}

function setActivationCounts(counts) {
  try {
    sessionStorage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(counts));
  } catch (_) {}
}

const DEFAULT_COUNTS = {
  company_card_clicks: 0,
  company_cards_opened: 0,
  company_searches: 0,
  role_filters_applied: 0,
  year_filter_applied: 0,
  transition_filter_applied: 0,
  status_filter_applied: 0,
  min_max_transitions_applied: 0,
  tabs_switched: 0,
  clear_filters_clicks: 0,
};

/**
 * Increment an activation counter and send Activated with current session counts.
 */
export function incrementActivationCounter(key, sendEvent = true) {
  const counts = { ...DEFAULT_COUNTS, ...getActivationCounts() };
  counts[key] = (counts[key] || 0) + 1;
  setActivationCounts(counts);
  if (sendEvent) {
    trackActivated(counts);
  }
  return counts;
}

/**
 * Get current activation counts without incrementing (e.g. for Session Ended).
 */
export function getActivationCountsForSession() {
  return { ...DEFAULT_COUNTS, ...getActivationCounts() };
}

export { mixpanel };
