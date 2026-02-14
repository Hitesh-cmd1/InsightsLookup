/**
 * API client for the Flask insights backend (app.py).
 * In dev, use proxy (empty base) so requests go to same origin and get proxied to Flask.
 * Set REACT_APP_INSIGHTS_API_URL to override (e.g. production backend).
 */

const API_BASE =
  process.env.REACT_APP_INSIGHTS_API_URL !== undefined && process.env.REACT_APP_INSIGHTS_API_URL !== ''
    ? process.env.REACT_APP_INSIGHTS_API_URL.replace(/\/$/, '')
    : 'http://localhost:5001';

export async function searchOrganizations(orgName) {
  const trimmed = (orgName || '').trim();
  if (!trimmed) {
    return [];
  }
  const url = API_BASE
    ? `${API_BASE}/organizations?org_name=${encodeURIComponent(trimmed)}`
    : `/organizations?org_name=${encodeURIComponent(trimmed)}`;
  let res;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch (netErr) {
    const msg =
      netErr.message && netErr.message.includes('Failed to fetch')
        ? 'Backend unavailable. Start the Flask app (e.g. python app.py) on port 5001.'
        : netErr.message || 'Network error';
    throw new Error(msg);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      res.status === 500
        ? 'Server error. Check that the database is set up and the Flask app is running.'
        : err.error || `Search failed: ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

export async function getOrgTransitions(orgId, { startDate, endDate, hops = 3, role } = {}) {
  const id = orgId != null ? Number(orgId) : null;
  if (id == null || Number.isNaN(id)) {
    throw new Error('org_id is required');
  }
  const params = new URLSearchParams({ org_id: String(id), hops: String(hops) });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  // Optional free-text role filter to highlight companies that hired
  // from this org into similar roles (handled in /org-transitions).
  if (role) params.set('role', role);
  const url = API_BASE
    ? `${API_BASE}/org-transitions?${params.toString()}`
    : `/org-transitions?${params.toString()}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Transitions failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch employees who transitioned from a source org to a destination org
 * in exactly `hop` moves within an optional date range and optional role filter.
 */
export async function getEmployeeTransitions(
  sourceOrgId,
  destOrgId,
  { hop, startDate, endDate, role } = {}
) {
  const source = sourceOrgId != null ? Number(sourceOrgId) : null;
  const dest = destOrgId != null ? Number(destOrgId) : null;
  const hopNum = hop != null ? Number(hop) : null;

  if (source == null || Number.isNaN(source)) {
    throw new Error('source_org_id is required');
  }
  if (dest == null || Number.isNaN(dest)) {
    throw new Error('dest_org_id is required');
  }
  if (hopNum == null || Number.isNaN(hopNum) || hopNum < 1) {
    throw new Error('hop must be a positive integer');
  }

  const params = new URLSearchParams({
    source_org_id: String(source),
    dest_org_id: String(dest),
    hop: String(hopNum),
  });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  if (role) params.set('role', role);

  const url = API_BASE
    ? `${API_BASE}/employee-transitions?${params.toString()}`
    : `/employee-transitions?${params.toString()}`;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Employee transitions failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch all alumni for a given organization (people who worked there and left).
 */
export async function getAlumni(orgId, { startDate, endDate } = {}) {
  const id = orgId != null ? Number(orgId) : null;
  if (id == null || Number.isNaN(id)) {
    throw new Error('org_id is required');
  }
  const params = new URLSearchParams({ org_id: String(id) });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);

  const url = API_BASE
    ? `${API_BASE}/alumni?${params.toString()}`
    : `/alumni?${params.toString()}`;

  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch alumni: ${res.status}`);
  }
  return res.json();
}

/**
 * Auth Endpoints
 */
export async function requestOTP(email) {
  const url = API_BASE ? `${API_BASE}/request-otp` : '/request-otp';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    credentials: 'include'
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to request OTP');
  }
  return res.json();
}

export async function verifyOTP(email, code) {
  const url = API_BASE ? `${API_BASE}/verify-otp` : '/verify-otp';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
    credentials: 'include'
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to verify OTP');
  }
  return res.json();
}

export async function logoutUser() {
  const url = API_BASE ? `${API_BASE}/logout` : '/logout';
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include'
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to logout');
  }
  return res.json();
}
