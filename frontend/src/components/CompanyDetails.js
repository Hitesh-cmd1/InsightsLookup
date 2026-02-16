import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { getEmployeeTransitions } from '../api/insights';
import { useAuth } from '../context/AuthContext';
import { trackCoreFeatureUsed } from '../analytics/mixpanel';
import { TrendingUp, LogOut, User as UserIcon } from 'lucide-react';

const CompanyDetails = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, openLogin, logout, loading: authLoading } = useAuth();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const {
    sourceOrgId,
    destOrgId,
    companyName,
    hop: initialHop,
    startYear,
    endYear,
    role,
  } = location.state || {};

  const [hop, setHop] = useState(initialHop || 1);
  const [roleFilter, setRoleFilter] = useState(role || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [employees, setEmployees] = useState([]);

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
    })
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        // Sort matched employees to the top
        list.sort((a, b) => {
          if (a.role_match === b.role_match) return 0;
          return a.role_match ? -1 : 1;
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
  }, [sourceOrgId, destOrgId, hop, startYear, endYear, roleFilter, user, openLogin, authLoading]);

  const totalEmployees = employees.length;

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
              <button
                onClick={() => navigate(-1)}
                className="p-2 rounded-lg border border-[#E7E5E4] hover:bg-[#F5F5F4] mr-2"
              >
                <ArrowLeft className="w-4 h-4 text-[#1C1917]" />
              </button>
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
              onChange={(e) => setHop(Number(e.target.value))}
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] bg-white cursor-pointer"
            >
              <option value={1}>1st transition</option>
              <option value={2}>2nd transition</option>
              <option value={3}>3rd transition</option>
            </select>
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

        {!loading && !error && employees.length === 0 && (
          <div className="text-center py-16 text-[#78716C]">
            No employees found for this transition.
          </div>
        )}

        {!loading && !error && employees.length > 0 && (
          <div className="space-y-4">
            {employees.map((emp) => (
              <div
                key={emp.employee_id}
                className={`bg-white border rounded-xl p-4 shadow-sm ${emp.role_match
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
                      {emp.role_match && (
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
                            <tr key={idx} className={rowClass}>
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
      </div>
    </div>
  );
};

export default CompanyDetails;

