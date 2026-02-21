import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ExternalLink } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { getEmployeeTransitions, getRelatedBackground } from '../api/insights';
import { useAuth } from '../context/AuthContext';
import { trackCoreFeatureUsed } from '../analytics/mixpanel';
import { TrendingUp, LogOut, User as UserIcon } from 'lucide-react';

const CONNECTION_FILTERS_STORAGE_KEY = 'insightsConnectionFiltersState';

const CompanyDetails = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, openLogin, logout, loading: authLoading } = useAuth();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const resolvedParams = useMemo(() => {
    const queryParams = new URLSearchParams(location.search);
    const parseIntOrNull = (value) => {
      if (value == null || value === '') return null;
      const n = Number(value);
      return Number.isNaN(n) ? null : n;
    };
    const parsedConnectionFilters = (() => {
      const raw = queryParams.get('cf');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch {
        try {
          const decoded = decodeURIComponent(raw);
          const parsed = JSON.parse(decoded);
          return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
          return null;
        }
      }
    })();
    const storedConnectionFilters = (() => {
      try {
        const raw = sessionStorage.getItem(CONNECTION_FILTERS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const applied = parsed?.appliedConnectionFilters;
        return applied && typeof applied === 'object' ? applied : null;
      } catch {
        return null;
      }
    })();
    const routeState = location.state || {};
    return {
      sourceOrgId: routeState.sourceOrgId ?? parseIntOrNull(queryParams.get('sourceOrgId')),
      destOrgId: routeState.destOrgId ?? parseIntOrNull(queryParams.get('destOrgId')),
      companyName: routeState.companyName ?? queryParams.get('companyName') ?? '',
      initialHop: routeState.hop ?? parseIntOrNull(queryParams.get('hop')) ?? 1,
      startYear: routeState.startYear ?? queryParams.get('startYear') ?? '',
      endYear: routeState.endYear ?? queryParams.get('endYear') ?? '',
      role: routeState.role ?? queryParams.get('role') ?? '',
      connectionFilters: routeState.connectionFilters ?? parsedConnectionFilters ?? storedConnectionFilters,
      prefetchedRelatedBackground: routeState.relatedBackground,
    };
  }, [location.search, location.state]);
  const {
    sourceOrgId,
    destOrgId,
    companyName,
    initialHop,
    startYear,
    endYear,
    role,
    connectionFilters,
    prefetchedRelatedBackground,
  } = resolvedParams;

  const [hop, setHop] = useState(initialHop || 1);
  const [roleFilter, setRoleFilter] = useState(role || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [relatedBackground, setRelatedBackground] = useState([]);
  const [loadingRelated, setLoadingRelated] = useState(false);
  const [peopleTab, setPeopleTab] = useState('transition'); // 'transition' | 'related'
  const [hopNudge, setHopNudge] = useState('');
  const [showRelatedMatchCue, setShowRelatedMatchCue] = useState(false);
  const hasConnectionFilters = useMemo(() => {
    if (!connectionFilters || typeof connectionFilters !== 'object') return false;
    const keys = ['past_companies', 'past_roles', 'tenure_options', 'colleges', 'departments', 'batch_options'];
    return keys.some((k) => Array.isArray(connectionFilters[k]) && connectionFilters[k].length > 0);
  }, [connectionFilters]);

  const filteredEmployees = useMemo(() => {
    const list = Array.isArray(employees) ? employees : [];
    const q = String(roleFilter || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((emp) => {
      if (emp?.role_match) return true;
      return (emp?.experience_history || []).some((exp) =>
        String(exp?.role || '').toLowerCase().includes(q)
      );
    });
  }, [employees, roleFilter]);

  const filteredRelatedBackground = useMemo(() => {
    const list = Array.isArray(relatedBackground) ? relatedBackground : [];
    const q = String(roleFilter || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((person) =>
      (person?.experience_history || []).some((exp) =>
        String(exp?.role || '').toLowerCase().includes(q)
      )
    );
  }, [relatedBackground, roleFilter]);

  useEffect(() => {
    if (!hasConnectionFilters) {
      setShowRelatedMatchCue(false);
      return;
    }
    if (peopleTab === 'related') {
      setShowRelatedMatchCue(false);
      return;
    }
    const hasMatchedRelated = (relatedBackground || []).some((p) => p?.is_match);
    setShowRelatedMatchCue(hasMatchedRelated);
  }, [hasConnectionFilters, peopleTab, relatedBackground]);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      openLogin();
      return;
    }

    if (!sourceOrgId || !destOrgId) {
      setError('Missing source or destination organization information.');
      setLoading(false);
      return;
    }

    const startDate = startYear ? `${startYear}-01-01` : null;
    const endDate = endYear ? `${endYear}-12-31` : null;

    setLoading(true);
    setError(null);

    getEmployeeTransitions(sourceOrgId, destOrgId, {
      hop,
      startDate,
      endDate,
      role: roleFilter || undefined,
      connectionFilters: hasConnectionFilters ? connectionFilters : undefined,
    })
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        // Keep filter/role matched people at top for consistent scan order.
        list.sort((a, b) => {
          if ((a.is_match || false) !== (b.is_match || false)) return a.is_match ? -1 : 1;
          if ((a.role_match || false) !== (b.role_match || false)) return a.role_match ? -1 : 1;
          return String(a.employee_name || '').localeCompare(String(b.employee_name || ''));
        });
        setEmployees(list);
        trackCoreFeatureUsed('transition_analysis', {
          source_org_id: sourceOrgId,
          dest_org_id: destOrgId,
          company_name: companyName,
          hop,
          employee_count: list.length,
        });
      })
      .catch((err) => {
        setError(err.message || 'Failed to load employee transitions');
        setEmployees([]);
      })
      .finally(() => setLoading(false));
  }, [sourceOrgId, destOrgId, hop, startYear, endYear, roleFilter, connectionFilters, hasConnectionFilters, user, openLogin, authLoading, companyName]);

  useEffect(() => {
    if (!sourceOrgId || !destOrgId || !user) return;
    const sortRelated = (list) => {
      list.sort((a, b) => {
        if ((a.is_match || false) !== (b.is_match || false)) return a.is_match ? -1 : 1;
        return String(a.employee_name || '').localeCompare(String(b.employee_name || ''));
      });
      return list;
    };
    const prefetched = prefetchedRelatedBackground;
    if (prefetched && typeof prefetched === 'object' && Array.isArray(prefetched.related)) {
      setRelatedBackground(sortRelated([...prefetched.related]));
      setLoadingRelated(false);
      return;
    }
    const startDate = startYear ? `${startYear}-01-01` : null;
    const endDate = endYear ? `${endYear}-12-31` : null;
    setLoadingRelated(true);
    getRelatedBackground(sourceOrgId, destOrgId, {
      startDate,
      endDate,
      connectionFilters: hasConnectionFilters ? connectionFilters : undefined,
    })
      .then((data) => {
        const list = Array.isArray(data.related) ? data.related : [];
        setRelatedBackground(sortRelated(list));
      })
      .catch(() => setRelatedBackground([]))
      .finally(() => setLoadingRelated(false));
  }, [sourceOrgId, destOrgId, startYear, endYear, user, prefetchedRelatedBackground, connectionFilters, hasConnectionFilters]);

  const totalEmployees = peopleTab === 'related' ? filteredRelatedBackground.length : filteredEmployees.length;

  const getMatchDetails = (person) => {
    const details = person?.filter_match_details;
    if (!details || typeof details !== 'object') {
      return { work_matches: [], education_matches: [] };
    }
    return {
      work_matches: Array.isArray(details.work_matches) ? details.work_matches : [],
      education_matches: Array.isArray(details.education_matches) ? details.education_matches : [],
    };
  };

  const buildWorkKey = (item) => [
    item?.organization || '',
    item?.role || '',
    item?.start_date || '',
    item?.end_date || '',
  ].join('|');

  const experienceMatchedByFilter = (person, exp) => {
    const details = getMatchDetails(person);
    const workKeys = new Set((details.work_matches || []).map(buildWorkKey));
    return workKeys.has(buildWorkKey(exp));
  };

  const personHasFilterEvidence = (person) => {
    const details = getMatchDetails(person);
    return (details.work_matches || []).length > 0 || (details.education_matches || []).length > 0;
  };

  const getTopCompanyNames = (experienceHistory = []) => {
    const names = [];
    const seen = new Set();
    for (const exp of experienceHistory || []) {
      const org = String(exp?.organization || '').trim();
      const key = org.toLowerCase();
      if (!org || seen.has(key)) continue;
      seen.add(key);
      names.push(org);
      if (names.length >= 2) break;
    }
    return names;
  };

  const buildLinkedInSearchUrl = (name, companyNames = []) => {
    const queryParts = [
      String(name || '').trim(),
      ...companyNames.slice(0, 2).map((c) => String(c || '').trim()).filter(Boolean),
      'linkedin',
    ].filter(Boolean);
    return `https://www.google.com/search?q=${encodeURIComponent(queryParts.join(' '))}`;
  };

  const handleHopChange = (value) => {
    if (peopleTab === 'related') {
      setHopNudge('Hop works for Transition People. Switch to that tab to change it.');
      return;
    }
    setHopNudge('');
    setHop(value);
  };

  const handlePeopleTabChange = (tab) => {
    if (tab === 'related') {
      setShowRelatedMatchCue(false);
    }
    setPeopleTab(tab);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-[#3B82F6] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-[#E7E5E4]">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate('/')}
            >
              <div className="w-8 h-8 bg-[#1C1917] rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-[#1C1917]" style={{ fontFamily: "'Playfair Display', serif" }}>
                Insights
              </span>
            </div>

            <div className="h-8 w-px bg-[#E7E5E4]" />
            <div className="flex items-center gap-3">
              <div>
                <h1
                  className="text-xl font-bold text-[#1C1917]"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {companyName || 'Company'} – Employees
                </h1>
                <p className="text-sm text-[#78716C]">
                  {startYear && endYear
                    ? `Alumni who reached ${companyName || 'this company'} in hop ${hop} (${startYear}–${endYear})`
                    : `Alumni who reached ${companyName || 'this company'} in hop ${hop}`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-sm text-[#78716C]">Total People</p>
              <p
                className="text-2xl font-bold text-[#1C1917]"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}
              >
                {totalEmployees}
              </p>
            </div>

            <div className="relative">
              {user ? (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                    className="w-10 h-10 bg-[#1C1917]/5 hover:bg-[#1C1917]/10 rounded-full flex items-center justify-center transition-all"
                  >
                    <UserIcon className="w-5 h-5 text-[#1C1917]" />
                  </button>

                  <AnimatePresence>
                    {isProfileMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-white border border-[#E7E5E4] rounded-xl shadow-lg p-2 z-40"
                      >
                        <div className="px-3 py-2 border-b border-[#E7E5E4] mb-1">
                          <p className="text-xs text-[#78716C]">Signed in as</p>
                          <p className="text-sm font-semibold text-[#1C1917] truncate">{user.name}</p>
                        </div>
                        <button
                          onClick={() => {
                            logout();
                            setIsProfileMenuOpen(false);
                            navigate('/');
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#EF4444] hover:bg-[#EF4444]/5 rounded-lg transition-all"
                        >
                          <LogOut className="w-4 h-4" />
                          Logout
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <button
                  onClick={() => openLogin()}
                  className="px-6 py-2 bg-[#1C1917]/5 hover:bg-[#1C1917] hover:text-white rounded-full text-sm font-semibold transition-all"
                >
                  Login
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Controls */}
      <div className="bg-white border-b border-[#E7E5E4]">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-xs font-medium text-[#1C1917] mb-1">
              Transition hop
            </label>
            <select
              value={hop}
              onChange={(e) => handleHopChange(Number(e.target.value))}
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] bg-white cursor-pointer"
            >
              <option value={1}>1st transition</option>
              <option value={2}>2nd transition</option>
              <option value={3}>3rd transition</option>
            </select>
            {hopNudge && (
              <p className="text-[11px] text-amber-700 mt-1">{hopNudge}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[#1C1917] mb-1">
              Filter by role (optional)
            </label>
            <input
              type="text"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              placeholder="e.g. Product Manager"
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] w-64"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-10 h-10 text-[#3B82F6] animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-6 py-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {!loading && !error && employees.length === 0 && (relatedBackground || []).length === 0 && !loadingRelated && (
          <div className="text-center py-16 text-[#78716C]">
            No employees found for this transition.
          </div>
        )}

        {!loading && !error && (employees.length > 0 || (relatedBackground || []).length > 0) && (
          <div>
            {/* Chrome-style tabs */}
            <div className="flex border-b border-[#E7E5E4] mb-6">
              <button
                type="button"
                onClick={() => handlePeopleTabChange('transition')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${peopleTab === 'transition'
                  ? 'border-[#3B82F6] text-[#3B82F6]'
                  : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                  }`}
              >
                Transition People
              </button>
              {(relatedBackground || []).length > 0 && (
                <button
                  type="button"
                  onClick={() => handlePeopleTabChange('related')}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px inline-flex items-center gap-2 ${peopleTab === 'related'
                    ? 'border-[#22C55E] text-[#22C55E]'
                    : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                    }`}
                >
                  Related to Your Background
                  {showRelatedMatchCue && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#22C55E]/15 text-[#15803D] text-[10px] font-semibold uppercase tracking-wide">
                      New match
                    </span>
                  )}
                </button>
              )}
            </div>

            {peopleTab === 'transition' && (
              <section>
                <p className="text-xs text-[#78716C] mb-4">
                  People who moved from the source company to this company.
                </p>
                {filteredEmployees.length === 0 ? (
                  <div className="text-sm text-[#78716C] bg-white border border-[#E7E5E4] rounded-xl p-4">
                    No transition people found for this hop.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredEmployees.map((emp) => (
                      <div
                        key={emp.employee_id}
                        className={`bg-white border rounded-xl p-4 shadow-sm ${((hasConnectionFilters && emp.is_match) || (!hasConnectionFilters && emp.role_match))
                          ? 'border-blue-500 ring-1 ring-blue-500'
                          : 'border-[#E7E5E4]'
                          }`}
                      >
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p
                              className="text-base font-semibold text-[#1C1917]"
                              style={{ fontFamily: "'Playfair Display', serif" }}
                            >
                              {emp.employee_name || `Employee ${emp.employee_id}`}
                            </p>
                            <a
                              href={buildLinkedInSearchUrl(emp.employee_name || `Employee ${emp.employee_id}`, getTopCompanyNames(emp.experience_history))}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Search ${(emp.employee_name || `Employee ${emp.employee_id}`)} on LinkedIn`}
                              className="inline-flex items-center text-[#2563EB] hover:text-[#1D4ED8]"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            {(hasConnectionFilters && emp.is_match) && (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-full">
                                Filter Matched
                              </span>
                            )}
                            {!hasConnectionFilters && emp.role_match && (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-full">
                                Role Matched
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#78716C]">
                            Exit: {emp.exit_date || '—'} · Transition: {emp.transition_date || '—'}
                          </p>
                        </div>
                      </div>

                      {(hasConnectionFilters && emp.is_match && personHasFilterEvidence(emp)) && (
                        <div className="mb-3 space-y-2">
                          {(getMatchDetails(emp).work_matches || []).length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide mb-1">Matched work criteria</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(getMatchDetails(emp).work_matches || []).map((m, idx) => (
                                  <span key={`trans-work-match-${idx}`} className="px-2 py-1 text-[11px] rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                    {(m.organization || 'Unknown')} {m.role ? `• ${m.role}` : ''} {Array.isArray(m.matched_fields) && m.matched_fields.length > 0 ? `(${m.matched_fields.join(', ')})` : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(getMatchDetails(emp).education_matches || []).length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide mb-1">Matched education criteria</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(getMatchDetails(emp).education_matches || []).map((m, idx) => (
                                  <span key={`trans-edu-match-${idx}`} className="px-2 py-1 text-[11px] rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                    {(m.school || 'Unknown')} {m.degree ? `• ${m.degree}` : ''} {Array.isArray(m.matched_fields) && m.matched_fields.length > 0 ? `(${m.matched_fields.join(', ')})` : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-medium text-[#78716C] mb-2">
                          Experience history
                        </p>
                        <div className="mb-2 flex flex-wrap gap-3 text-[10px]">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" />
                            Source (exit)
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-slate-100 border border-slate-300" />
                            Internal (same org)
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-400" />
                            Hop used for this transition
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-blue-50 border border-blue-200" />
                            Other hops
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm bg-transparent" />
                            Prior
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-[#E7E5E4] bg-[#F5F5F4]">
                                <th className="px-3 py-2 font-semibold text-[#1C1917]">
                                  Organization
                                </th>
                                <th className="px-3 py-2 font-semibold text-[#1C1917]">
                                  Role
                                </th>
                                <th className="px-3 py-2 font-semibold text-[#1C1917]">
                                  Start
                                </th>
                                <th className="px-3 py-2 font-semibold text-[#1C1917]">
                                  End
                                </th>
                                <th className="px-3 py-2 font-semibold text-[#1C1917] w-28">
                                  Used for
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {(emp.experience_history || []).map((exp, idx) => {
                                const seg = exp.transition_segment || 'prior';
                                const isHopUsed = seg === `hop_${hop}`;
                                const filterMatchedRow = experienceMatchedByFilter(emp, exp);
                                const rowClass =
                                  seg === 'source'
                                    ? 'bg-amber-50 border-b border-[#F5F5F4] border-l-4 border-l-amber-400'
                                    : seg === 'internal_at_source'
                                      ? 'bg-slate-50 border-b border-[#F5F5F4] border-l-4 border-l-slate-300'
                                      : isHopUsed
                                        ? 'bg-emerald-50 border-b border-[#F5F5F4] border-l-4 border-l-emerald-500 font-medium'
                                        : seg.startsWith('hop_')
                                          ? 'bg-blue-50/70 border-b border-[#F5F5F4] border-l-4 border-l-blue-200'
                                          : 'border-b border-[#F5F5F4]';
                                const label =
                                  seg === 'source'
                                    ? 'Source (exit)'
                                    : seg === 'internal_at_source'
                                      ? 'Internal (same org)'
                                      : isHopUsed
                                        ? `Hop ${hop} (this transition)`
                                        : seg.startsWith('hop_')
                                          ? `Hop ${seg.replace('hop_', '')}`
                                          : '—';
                                return (
                                  <tr key={idx} className={`${rowClass} ${filterMatchedRow ? 'bg-blue-100/70' : ''}`}>
                                    <td className="px-3 py-2 text-[#1C1917]">
                                      {exp.organization || 'Unknown'}
                                    </td>
                                    <td className="px-3 py-2 text-[#78716C]">
                                      {exp.role || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-[#78716C]">
                                      {exp.start_date || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-[#78716C]">
                                      {exp.end_date || '—'}
                                    </td>
                                    <td className="px-3 py-2 text-[#78716C] font-medium">
                                      {label}
                                      {filterMatchedRow && (
                                        <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold uppercase tracking-wide">
                                          Filter
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {peopleTab === 'related' && (relatedBackground || []).length > 0 && (
              <section>
                {loadingRelated && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 text-[#22C55E] animate-spin" />
                  </div>
                )}
                {!loadingRelated && (
                  <>
                    <p className="text-xs text-[#78716C] mb-4">
                      People at this company who match your profile (same past company or college) but did not transition from the source company.
                    </p>
                    {filteredRelatedBackground.length === 0 && (
                      <div className="text-xs text-[#78716C] mb-4">
                        No related people match this role filter.
                      </div>
                    )}
                    <div className="space-y-4">
                      {filteredRelatedBackground.map((person) => (
                        <div
                          key={person.employee_id}
                          className={`bg-white border rounded-xl p-4 shadow-sm ${person.is_match ? 'border-[#3B82F6] ring-2 ring-[#3B82F6]/90' : 'border-[#E7E5E4]'}`}
                        >
                          <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-2">
                            <p className="text-base font-semibold text-[#1C1917]" style={{ fontFamily: "'Playfair Display', serif" }}>
                              {person.employee_name || `Employee ${person.employee_id}`}
                            </p>
                            <a
                              href={buildLinkedInSearchUrl(person.employee_name || `Employee ${person.employee_id}`, getTopCompanyNames(person.experience_history))}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Search ${(person.employee_name || `Employee ${person.employee_id}`)} on LinkedIn`}
                              className="inline-flex items-center text-[#2563EB] hover:text-[#1D4ED8]"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-medium uppercase tracking-wider rounded-full">
                              {person.connection_type === 'past_company_and_college' ? 'Company & College' : person.connection_type === 'past_company' ? 'Past company' : 'College'}
                            </span>
                              {person.is_match && (
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-semibold uppercase tracking-wider rounded-full">
                                  Filter matched
                                </span>
                              )}
                            </div>
                          </div>
                          {(person.is_match && personHasFilterEvidence(person)) && (
                            <div className="mb-3 space-y-2">
                              {(getMatchDetails(person).work_matches || []).length > 0 && (
                                <div>
                                  <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide mb-1">Matched work criteria</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {(getMatchDetails(person).work_matches || []).map((m, idx) => (
                                      <span key={`work-match-${idx}`} className="px-2 py-1 text-[11px] rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                        {(m.organization || 'Unknown')} {m.role ? `• ${m.role}` : ''} {Array.isArray(m.matched_fields) && m.matched_fields.length > 0 ? `(${m.matched_fields.join(', ')})` : ''}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(getMatchDetails(person).education_matches || []).length > 0 && (
                                <div>
                                  <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide mb-1">Matched education criteria</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {(getMatchDetails(person).education_matches || []).map((m, idx) => (
                                      <span key={`edu-match-${idx}`} className="px-2 py-1 text-[11px] rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                        {(m.school || 'Unknown')} {m.degree ? `• ${m.degree}` : ''} {Array.isArray(m.matched_fields) && m.matched_fields.length > 0 ? `(${m.matched_fields.join(', ')})` : ''}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-medium text-[#78716C] mb-2">Experience history</p>
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-[#E7E5E4] bg-[#F5F5F4]">
                                    <th className="px-3 py-2 font-semibold text-[#1C1917]">Organization</th>
                                    <th className="px-3 py-2 font-semibold text-[#1C1917]">Role</th>
                                    <th className="px-3 py-2 font-semibold text-[#1C1917]">Start</th>
                                    <th className="px-3 py-2 font-semibold text-[#1C1917]">End</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(person.experience_history || []).map((exp, idx) => (
                                    <tr key={idx} className={`border-b ${experienceMatchedByFilter(person, exp) ? 'border-blue-200 bg-blue-50/60' : 'border-[#F5F5F4]'}`}>
                                      <td className="px-3 py-2 text-[#1C1917]">{exp.organization || '—'}</td>
                                      <td className="px-3 py-2 text-[#78716C]">{exp.role || '—'}</td>
                                      <td className="px-3 py-2 text-[#78716C]">{exp.start_date || '—'}</td>
                                      <td className="px-3 py-2 text-[#78716C]">{exp.end_date || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanyDetails;
