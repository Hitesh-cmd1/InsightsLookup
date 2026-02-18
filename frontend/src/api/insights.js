/**
 * API client for the Flask insights backend (app.py).
 * In dev, use proxy (empty base) so requests go to same origin and get proxied to Flask.
 * Set REACT_APP_INSIGHTS_API_URL to override (e.g. production backend).
 */

const API_BASE =
  process.env.REACT_APP_INSIGHTS_API_URL !== undefined && process.env.REACT_APP_INSIGHTS_API_URL !== ''
    ? process.env.REACT_APP_INSIGHTS_API_URL.replace(/\/$/, '')
    : ''; // In dev, use proxy (empty base) so requests go to same origin and get proxied to Flask.

function getAuthHeaders() {
  const token = localStorage.getItem('insights_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

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
    res = await fetch(url, { headers: getAuthHeaders() });
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

/**
 * Build connection_filters query param (JSON) for org-transitions and alumni.
 * All arrays: empty = no filter (All / Any). Multiple = OR within category, AND across.
 */
export function buildConnectionFiltersParam(filters) {
  if (!filters) return null;
  const payload = {
    past_companies: filters.past_companies || [],
    past_roles: filters.past_roles || [],
    tenure_options: filters.tenure_options || [],
    colleges: filters.colleges || [],
    departments: filters.departments || [],
    batch_options: filters.batch_options || [],
  };
  return JSON.stringify(payload);
}

export async function getOrgTransitions(orgId, { startDate, endDate, hops = 3, role, connectionFilters, includeRelated } = {}) {
  const id = orgId != null ? Number(orgId) : null;
  if (id == null || Number.isNaN(id)) {
    throw new Error('org_id is required');
  }
  const params = new URLSearchParams({ org_id: String(id), hops: String(hops) });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  if (role) params.set('role', role);
  if (includeRelated) params.set('include_related', '1');
  const cf = buildConnectionFiltersParam(connectionFilters);
  if (cf) params.set('connection_filters', cf);
  const url = API_BASE
    ? `${API_BASE}/org-transitions?${params.toString()}`
    : `/org-transitions?${params.toString()}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
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

  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Employee transitions failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch all alumni for a given organization (people who worked there and left).
 * Optional connectionFilters filters by profile-based connections.
 */
export async function getAlumni(orgId, { startDate, endDate, connectionFilters } = {}) {
  const id = orgId != null ? Number(orgId) : null;
  if (id == null || Number.isNaN(id)) {
    throw new Error('org_id is required');
  }
  const params = new URLSearchParams({ org_id: String(id) });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const cf = buildConnectionFiltersParam(connectionFilters);
  if (cf) params.set('connection_filters', cf);

  const url = API_BASE
    ? `${API_BASE}/alumni?${params.toString()}`
    : `/alumni?${params.toString()}`;

  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch alumni: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch dashboard data in one call: filter_options, transitions, alumni (no connection filters).
 */
export async function getDashboardData(orgId, { startDate, endDate, hops = 3, role } = {}) {
  const id = orgId != null ? Number(orgId) : null;
  if (id == null || Number.isNaN(id)) {
    throw new Error('org_id is required');
  }
  const params = new URLSearchParams({ org_id: String(id), hops: String(hops) });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  if (role) params.set('role', role);
  const url = API_BASE
    ? `${API_BASE}/dashboard-data?${params.toString()}`
    : `/dashboard-data?${params.toString()}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Dashboard data failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch related-background people at a destination company (not from transition).
 */
export async function getRelatedBackground(sourceOrgId, destOrgId, { startDate, endDate } = {}) {
  const source = sourceOrgId != null ? Number(sourceOrgId) : null;
  const dest = destOrgId != null ? Number(destOrgId) : null;
  if (source == null || Number.isNaN(source) || dest == null || Number.isNaN(dest)) {
    throw new Error('source_org_id and dest_org_id are required');
  }
  const params = new URLSearchParams({ source_org_id: String(source), dest_org_id: String(dest) });
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const url = API_BASE
    ? `${API_BASE}/related-background?${params.toString()}`
    : `/related-background?${params.toString()}`;
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Related background failed: ${res.status}`);
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
    body: JSON.stringify({ email })
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
    body: JSON.stringify({ email, code })
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
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to logout');
  }
  return res.json();
}

/**
 * Profile Endpoints
 */
export async function getProfile() {
  const url = API_BASE ? `${API_BASE}/profile` : '/profile';
  const res = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load profile');
  }
  return res.json();
}

export async function updateProfile(payload) {
  const url = API_BASE ? `${API_BASE}/profile` : '/profile';
  const res = await fetch(url, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save profile');
  }
  return res.json();
}

export async function uploadResume(file) {
  const url = API_BASE ? `${API_BASE}/profile/resume` : '/profile/resume';
  const formData = new FormData();
  formData.append('resume', file);

  const headers = getAuthHeaders();
  // Let the browser set proper multipart boundary
  if (headers['Content-Type']) {
    delete headers['Content-Type'];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to upload resume');
  }
  return res.json();
}

export async function deleteResume() {
  const url = API_BASE ? `${API_BASE}/profile/resume` : '/profile/resume';
  const res = await fetch(url, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to remove resume');
  }
  return res.json();
}

export async function downloadResume(filename) {
  const url = API_BASE ? `${API_BASE}/profile/resume` : '/profile/resume';
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('insights_token')}`
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to download resume');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'resume.pdf';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
