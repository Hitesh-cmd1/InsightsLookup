import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, X, ExternalLink, Loader2, LogOut, User as UserIcon, TrendingUp } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { getOrgTransitions, getEmployeeTransitions, getAlumni } from '../api/insights';
import { useAuth } from '../context/AuthContext';

/**
 * Transform API /org-transitions response into two sets of company cards:
 * - 1st Transitions view
 * - 2nd Transitions view
 *
 * API shape (per hop key "1", "2", ...):
 * {
 *   "1": [
 *     {
 *       organization_id,
 *       organization,
 *       count,       // people who reached this org at hop 1
 *       total_count, // people who reached this org across *all* hops
 *       years: [...]
 *     },
 *     ...
 *   ],
 *   "2": [...]
 * }
 */
function mapTransitions(apiResult) {
  if (!apiResult || typeof apiResult !== 'object') {
    return { firstHopCompanies: [], secondHopCompanies: [] };
  }

  const hops = Object.keys(apiResult);
  if (hops.length === 0) {
    return { firstHopCompanies: [], secondHopCompanies: [] };
  }

  // Build a helper map of all hops per destination org
  const perOrg = new Map();

  Object.entries(apiResult).forEach(([hopStr, list]) => {
    const hopNum = Number(hopStr);
    if (!Array.isArray(list) || Number.isNaN(hopNum)) return;
    list.forEach((item) => {
      const orgId = item.organization_id;
      const orgName = item.organization;
      if (orgId == null || !orgName) return;

      if (!perOrg.has(orgId)) {
        perOrg.set(orgId, {
          organizationId: orgId,
          name: orgName,
          years: new Set(),
          hops: {}, // { [hopNumber]: count }
          totalCount: 0,
        });
      }
      const entry = perOrg.get(orgId);
      entry.hops[hopNum] = (entry.hops[hopNum] || 0) + (item.count || 0);
      entry.totalCount =
        item.total_count != null ? item.total_count : entry.totalCount + (item.count || 0);
      (item.years || []).forEach((y) => entry.years.add(y));
    });
  });

  // Helper to build card objects sorted by a specific hop
  function buildCardsForHop(hopNum) {
    const cards = [];
    perOrg.forEach((entry) => {
      const hopCount = entry.hops[hopNum] || 0;
      if (!hopCount) return;
      const yearsArr = Array.from(entry.years);
      const recentYear = yearsArr.length ? Math.max(...yearsArr) : null;
      const otherHopsCount = entry.totalCount - hopCount;

      cards.push({
        organizationId: entry.organizationId,
        name: entry.name,
        // Primary people metric for this section (1st / 2nd transitions)
        people: hopCount,
        // People who reached via the first hop
        firstHopCount: entry.hops[1] || 0,
        // People who reached via the second hop
        secondHopCount: entry.hops[2] || 0,
        // All people across all hops
        totalPeople: entry.totalCount,
        // People who reached via hops other than this hop
        otherHopsCount,
        recent: recentYear,
        // All hops breakdown (used for filtering/tooltip/etc.)
        transitions: Object.entries(entry.hops)
          .map(([h, c]) => ({ moves: Number(h), count: c }))
          .sort((a, b) => a.moves - b.moves),
        years: yearsArr.sort((a, b) => b - a),
      });
    });

    // Sort by primary people metric desc
    cards.sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));

    // Add rank
    return cards.map((c, idx) => ({ ...c, rank: idx + 1 }));
  }

  const firstHopCompanies = buildCardsForHop(1);
  const secondHopCompanies = buildCardsForHop(2);

  return { firstHopCompanies, secondHopCompanies };
}

const Dashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, openLogin, loading: authLoading } = useAuth();
  const stateFromRoute = location.state || {};
  const stateFromStorage = (() => {
    try {
      const raw = sessionStorage.getItem('insightsDashboardState');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })();
  const searchParams = { ...stateFromStorage, ...stateFromRoute };

  const [searchName, setSearchName] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedTransition, setSelectedTransition] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [minTransitions, setMinTransitions] = useState('');
  const [maxTransitions, setMaxTransitions] = useState('');
  const [noPostJourney, setNoPostJourney] = useState(false);
  const [dataBusinessRoles, setDataBusinessRoles] = useState(false);
  const [activeTab, setActiveTab] = useState('company-pathways');

  const [companiesFirst, setCompaniesFirst] = useState([]);
  const [companiesSecond, setCompaniesSecond] = useState([]);
  const [alumni, setAlumni] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingAlumni, setLoadingAlumni] = useState(false);
  const [error, setError] = useState(null);
  const [totalAlumni, setTotalAlumni] = useState(0);

  // role-based highlighting state
  const [contextRole, setContextRole] = useState(stateFromStorage.role || '');
  const [contextApplying, setContextApplying] = useState(false);
  const [highlightedOrgIds, setHighlightedOrgIds] = useState(new Set());
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const { logout } = useAuth();
  // Removed long mockCompanies list
  const years = Array.from({ length: 50 }, (_, i) => new Date().getFullYear() - i);

  const clearAllFilters = () => {
    setSearchName('');
    setSelectedYear('all');
    setSelectedTransition('all');
    setSelectedStatus('all');
    setMinTransitions('');
    setMaxTransitions('');
    setNoPostJourney(false);
    setDataBusinessRoles(false);
  };

  // Fetch org-transitions when we have orgId and date range
  useEffect(() => {
    const orgId = searchParams.orgId;
    const startYear = searchParams.startYear;
    const endYear = searchParams.endYear;

    if (authLoading) return;

    if (!user) {
      openLogin();
      return;
    }

    if (!orgId) {
      setCompaniesFirst([]);
      setCompaniesSecond([]);
      setTotalAlumni(0);
      setLoading(false);
      setError('Please select an organization to view insights');
      // Proactively navigate home if no context
      if (!location.state) navigate('/');
      return;
    }

    const startDate = startYear ? `${startYear}-01-01` : null;
    const endDate = endYear ? `${endYear}-12-31` : null;

    setLoading(true);
    setError(null);
    getOrgTransitions(orgId, { startDate, endDate, hops: 3, role: contextRole })
      .then((data) => {
        const { firstHopCompanies, secondHopCompanies } = mapTransitions(data);
        setCompaniesFirst(firstHopCompanies);
        setCompaniesSecond(secondHopCompanies);
        // For the "Total Alumni" header, continue to use sum of 1st-hop people
        const total = firstHopCompanies.reduce((sum, c) => sum + (c.people || 0), 0);
        setTotalAlumni(total);

        // Calculate highlights based on role_match
        const highlighted = new Set();
        if (data && typeof data === 'object') {
          Object.values(data).forEach((list) => {
            if (!Array.isArray(list)) return;
            list.forEach((item) => {
              if (!item || item.organization_id == null) return;
              const hasMatchFlag = item.role_match || item.match;
              if (hasMatchFlag) highlighted.add(item.organization_id);
            });
          });
        }
        setHighlightedOrgIds(highlighted);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load transitions');
        setCompaniesFirst([]);
        setCompaniesSecond([]);
        setTotalAlumni(0);
      })
      .finally(() => setLoading(false));
  }, [searchParams.orgId, searchParams.startYear, searchParams.endYear, contextRole, user, openLogin, authLoading]);

  // Fetch alumni when the tab is active
  useEffect(() => {
    if (activeTab !== 'alumni' || !searchParams.orgId) return;

    setLoadingAlumni(true);
    const startDate = searchParams.startYear ? `${searchParams.startYear}-01-01` : null;
    const endDate = searchParams.endYear ? `${searchParams.endYear}-12-31` : null;

    getAlumni(searchParams.orgId, { startDate, endDate })
      .then((data) => {
        setAlumni(data);
      })
      .catch((err) => {
        console.error('Failed to load alumni', err);
      })
      .finally(() => setLoadingAlumni(false));
  }, [activeTab, searchParams.orgId, searchParams.startYear, searchParams.endYear]);

  // Client-side filter by search name (and other filters if needed)
  const applyCommonFilters = (list) => {
    let next = list;
    if (searchName.trim()) {
      next = next.filter((c) =>
        c.name.toLowerCase().includes(searchName.toLowerCase())
      );
    }
    // Transition filter: filter by hop presence (1, 2, or 3+)
    if (selectedTransition !== 'all') {
      next = next.filter((c) => {
        const hops = (c.transitions || []).map((t) => t.moves);
        if (selectedTransition === '1') return hops.includes(1);
        if (selectedTransition === '2') return hops.includes(2);
        if (selectedTransition === '3+') return hops.some((m) => m >= 3);
        return true;
      });
    }
    // Year filter: include if any transition year matches
    if (selectedYear !== 'all') {
      const yearNum = Number(selectedYear);
      next = next.filter((c) => (c.years || []).includes(yearNum));
    }
    // Min/Max transitions filter using totalPeople as a proxy
    const minVal = minTransitions !== '' ? Number(minTransitions) : null;
    const maxVal = maxTransitions !== '' ? Number(maxTransitions) : null;
    if (minVal != null && !Number.isNaN(minVal)) {
      next = next.filter((c) => (c.totalPeople || c.people || 0) >= minVal);
    }
    if (maxVal != null && !Number.isNaN(maxVal)) {
      next = next.filter((c) => (c.totalPeople || c.people || 0) <= maxVal);
    }
    return next;
  };

  const filteredCompaniesFirst = applyCommonFilters(companiesFirst);
  const filteredCompaniesSecond = applyCommonFilters(companiesSecond);

  const isOrgHighlighted = (orgId) => highlightedOrgIds.has(orgId);

  // Filter alumni list
  const filteredAlumni = useMemo(() => {
    let next = alumni;
    if (searchName.trim()) {
      next = next.filter(a => a.name.toLowerCase().includes(searchName.toLowerCase()));
    }
    if (noPostJourney) {
      // "No post-company journey" means the path is empty (they are still at the company or we don't know where they went)
      // Actually, in the backend current_company defaults to org_id if path is empty.
      next = next.filter(a => !a.path || a.path.length === 0);
    }
    return next;
  }, [alumni, searchName, noPostJourney]);

  const applyRoleContext = async () => {
    const role = (contextRole || '').trim();

    // Save role to session storage for persistence
    try {
      const current = JSON.parse(sessionStorage.getItem('insightsDashboardState') || '{}');
      const updated = { ...current, role };
      sessionStorage.setItem('insightsDashboardState', JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to save state', e);
    }

    if (!role || !searchParams.orgId) {
      // If there is no role or org context, just clear any highlights.
      setHighlightedOrgIds(new Set());
      return;
    }

    const orgId = searchParams.orgId;
    const startDate = searchParams.startYear ? `${searchParams.startYear}-01-01` : null;
    const endDate = searchParams.endYear ? `${searchParams.endYear}-12-31` : null;

    setContextApplying(true);
    try {
      // Re-fetch org transitions with the role filter so the backend can
      // tell us which destination companies hired into similar roles.
      const data = await getOrgTransitions(orgId, {
        startDate,
        endDate,
        hops: 3,
        role,
      });

      const { firstHopCompanies, secondHopCompanies } = mapTransitions(data);
      setCompaniesFirst(firstHopCompanies);
      setCompaniesSecond(secondHopCompanies);

      // Build a highlight set from any hop where the backend indicates
      // a role match (supports both `role_match` and `match` flags).
      const highlighted = new Set();
      if (data && typeof data === 'object') {
        Object.values(data).forEach((list) => {
          if (!Array.isArray(list)) return;
          list.forEach((item) => {
            if (!item || item.organization_id == null) return;
            const hasMatchFlag = item.role_match || item.match;
            if (hasMatchFlag) highlighted.add(item.organization_id);
          });
        });
      }

      setHighlightedOrgIds(highlighted);
    } finally {
      setContextApplying(false);
    }
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
          <div className="flex items-center gap-3">
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
            <div className="h-8 w-px bg-[#E7E5E4] mx-2" />
            <div>
              <h1
                className="text-xl font-bold text-[#1C1917] cursor-pointer hover:text-[#3B82F6] transition-colors"
                style={{ fontFamily: "'Playfair Display', serif" }}
                onClick={() => navigate('/')}
                data-testid="app-title"
              >
                {searchParams.companyName || 'Company'} Alumni Tracker
              </h1>
              {searchParams.startYear && searchParams.endYear && (
                <p className="text-sm text-[#78716C]">
                  {searchParams.startYear} - {searchParams.endYear}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-sm text-[#78716C]">Total Alumni</p>
              <p className="text-2xl font-bold text-[#1C1917]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {totalAlumni}
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

      {/* Filters */}
      <div className="bg-white border-b border-[#E7E5E4]">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#78716C]" />
              <input
                type="text"
                placeholder="Search name..."
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                className="pl-9 pr-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] w-48"
                data-testid="search-name-input"
              />
            </div>

            {/* Role Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#78716C]" />
              <input
                type="text"
                placeholder="Role (e.g. Product)..."
                value={contextRole}
                onChange={(e) => setContextRole(e.target.value)}
                onBlur={applyRoleContext}
                onKeyDown={(e) => e.key === 'Enter' && applyRoleContext()}
                className="pl-9 pr-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] w-48"
                data-testid="role-search-input"
              />
            </div>

            {/* Year Filter */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] bg-white cursor-pointer"
              data-testid="year-filter"
            >
              <option value="all">All Years</option>
              {years.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            {/* Transitions Filter */}
            <select
              value={selectedTransition}
              onChange={(e) => setSelectedTransition(e.target.value)}
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] bg-white cursor-pointer"
              data-testid="transition-filter"
            >
              <option value="all">All Transitions</option>
              <option value="1">1 Transition</option>
              <option value="2">2 Transitions</option>
              <option value="3+">3+ Transitions</option>
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] bg-white cursor-pointer"
              data-testid="status-filter"
            >
              <option value="all">All Status</option>
              <option value="current">Current</option>
              <option value="past">Past</option>
            </select>

            {/* Min Transitions */}
            <input
              type="number"
              placeholder="Min transitions"
              value={minTransitions}
              onChange={(e) => setMinTransitions(e.target.value)}
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] w-32"
              data-testid="min-transitions-input"
            />

            {/* Max Transitions */}
            <input
              type="number"
              placeholder="Max transitions"
              value={maxTransitions}
              onChange={(e) => setMaxTransitions(e.target.value)}
              className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] w-32"
              data-testid="max-transitions-input"
            />
          </div>

          {/* Checkboxes and Clear All */}
          <div className="flex items-center gap-6 mt-3">
            <label className="flex items-center gap-2 text-sm text-[#1C1917] cursor-pointer">
              <input
                type="checkbox"
                checked={noPostJourney}
                onChange={(e) => setNoPostJourney(e.target.checked)}
                className="w-4 h-4 rounded border-[#E7E5E4]"
                data-testid="no-post-journey-checkbox"
              />
              No post-{searchParams.companyName || 'Company'} journey
            </label>
            <button
              onClick={clearAllFilters}
              className="ml-auto text-sm text-[#3B82F6] hover:underline"
              data-testid="clear-all-button"
            >
              Clear All
            </button>
            <span className="text-sm text-[#78716C]">
              Showing {filteredCompaniesFirst.length} companies
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-[#E7E5E4]">
        <div className="max-w-[1600px] mx-auto px-6">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab('company-pathways')}
              className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'company-pathways'
                ? 'border-[#3B82F6] text-[#3B82F6]'
                : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                }`}
              data-testid="company-pathways-tab"
            >
              Company Pathways
            </button>
            <button
              onClick={() => setActiveTab('career-transitions')}
              className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'career-transitions'
                ? 'border-[#3B82F6] text-[#3B82F6]'
                : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                }`}
              data-testid="career-transitions-tab"
            >
              Career Transitions
            </button>
            <button
              onClick={() => setActiveTab('alumni')}
              className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'alumni'
                ? 'border-[#3B82F6] text-[#3B82F6]'
                : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                }`}
              data-testid="alumni-tab"
            >
              Alumni ({totalAlumni})
            </button>
            <button
              onClick={() => setActiveTab('statistics')}
              className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'statistics'
                ? 'border-[#3B82F6] text-[#3B82F6]'
                : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                }`}
              data-testid="statistics-tab"
            >
              Statistics
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-8">
        {activeTab === 'company-pathways' && (
          <div>
            {/* Section Header */}
            <div className="flex items-center justify-between mb-6 bg-[#DBEAFE] px-6 py-4 rounded-lg">
              <h2 className="text-lg font-semibold text-[#1C1917]">
                1st Transitions
              </h2>
              <span className="text-sm text-[#78716C]">
                {filteredCompaniesFirst.length} companies
              </span>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-24" data-testid="loading-transitions">
                <Loader2 className="w-10 h-10 text-[#3B82F6] animate-spin" />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-6 py-4 rounded-lg mb-6" data-testid="transitions-error">
                {error}
              </div>
            )}

            {!loading && !error && (
              <>
                {/* Company Cards Grid */}
                <motion.div
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  {filteredCompaniesFirst.map((company, index) => (
                    <motion.div
                      key={company.name ? `${company.name}-${index}` : index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05, duration: 0.4 }}
                      whileHover={{ y: -4 }}
                      className={`bg-white border ${isOrgHighlighted(company.organizationId)
                        ? 'border-[#3B82F6] ring-2 ring-[#3B82F6]/100'
                        : 'border-[#E7E5E4]'
                        } rounded-xl p-6 hover:shadow-md transition-all cursor-pointer`}
                      data-testid={`company-card-${company.rank}`}
                      onClick={() =>
                        navigate('/company-details', {
                          state: {
                            sourceOrgId: searchParams.orgId,
                            destOrgId: company.organizationId,
                            companyName: company.name,
                            hop: 1,
                            startYear: searchParams.startYear,
                            endYear: searchParams.endYear,
                            role: contextRole,
                          },
                        })
                      }
                    >
                      {/* Rank Badge */}
                      <div className="inline-flex items-center justify-center bg-[#3B82F6] text-white text-sm font-bold rounded px-2 py-1 mb-3">
                        #{company.rank}
                      </div>

                      {/* Company Name */}
                      <div className="flex items-start gap-2 mb-4">
                        <h3
                          className="text-lg font-bold text-[#1C1917] flex-1"
                          style={{ fontFamily: "'Playfair Display', serif" }}
                        >
                          {company.name}
                        </h3>
                        <a
                          href={`https://google.com/search?q=${encodeURIComponent(company.name)}+careers`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()} // Prevent card click navigation
                        >
                          <ExternalLink className="w-4 h-4 text-[#78716C] flex-shrink-0 cursor-pointer hover:text-[#3B82F6]" />
                        </a>
                      </div>

                      {/* People and Recent */}
                      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">People (1st transition):</p>
                          <p className="text-xl font-bold text-[#1C1917]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {company.people}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">People (all transitions):</p>
                          <p className="text-xl font-bold text-[#1C1917]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {company.totalPeople}
                          </p>
                        </div>
                      </div>

                      {/* Recent */}
                      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">Recent:</p>
                          <p className="text-xl font-bold text-[#1C1917]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {company.recent}
                          </p>
                        </div>
                      </div>

                      {/* By transitions */}
                      <div className="mb-4">
                        <p className="text-xs font-medium text-[#78716C] mb-2">By transitions:</p>
                        <div className="space-y-1">
                          {(company.transitions || []).map((t, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-[#78716C]">{t.moves} move{t.moves > 1 ? 's' : ''}:</span>
                              <span className="font-semibold text-[#1C1917]">{t.count} people</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Years */}
                      <div className="flex flex-wrap gap-2">
                        {(company.years || []).map((year, i) => (
                          <span
                            key={i}
                            className="px-3 py-1 bg-[#F5F5F4] text-[#1C1917] text-sm font-medium rounded-md"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {year}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </>
            )}
            {/* 2nd Transitions Section */}
            {filteredCompaniesSecond.length > 0 && (
              <>
                <div className="flex items-center justify-between mt-10 mb-6 bg-[#F3E8FF] px-6 py-4 rounded-lg">
                  <h2 className="text-lg font-semibold text-[#1C1917]">
                    2nd Transitions
                  </h2>
                  <span className="text-sm text-[#78716C]">
                    {filteredCompaniesSecond.length} companies
                  </span>
                </div>

                <motion.div
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  {filteredCompaniesSecond.map((company, index) => (
                    <motion.div
                      key={company.name ? `${company.name}-2nd-${index}` : `2nd-${index}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05, duration: 0.4 }}
                      whileHover={{ y: -4 }}
                      className="bg-white border border-[#E7E5E4] rounded-xl p-6 hover:shadow-md transition-all cursor-pointer"
                      onClick={() =>
                        navigate('/company-details', {
                          state: {
                            sourceOrgId: searchParams.orgId,
                            destOrgId: company.organizationId,
                            companyName: company.name,
                            hop: 2,
                            startYear: searchParams.startYear,
                            endYear: searchParams.endYear,
                            role: contextRole,
                          },
                        })
                      }
                    >
                      <div className="inline-flex items-center justify-center bg-[#A855F7] text-white text-sm font-bold rounded px-2 py-1 mb-3">
                        #{company.rank}
                      </div>

                      <div className="flex items-start gap-2 mb-4">
                        <h3
                          className="text-lg font-bold text-[#1C1917] flex-1"
                          style={{ fontFamily: "'Playfair Display', serif" }}
                        >
                          {company.name}
                        </h3>
                        <a
                          href="https://google.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()} // Prevent card click navigation
                        >
                          <ExternalLink className="w-4 h-4 text-[#78716C] flex-shrink-0 cursor-pointer hover:text-[#3B82F6]" />
                        </a>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">People (2nd transition):</p>
                          <p
                            className="text-xl font-bold text-[#1C1917]"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {company.people}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">People (other transitions):</p>
                          <p
                            className="text-xl font-bold text-[#1C1917]"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {company.otherHopsCount}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">People (all transitions):</p>
                          <p
                            className="text-xl font-bold text-[#1C1917]"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {company.totalPeople}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">Recent:</p>
                          <p
                            className="text-xl font-bold text-[#1C1917]"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {company.recent}
                          </p>
                        </div>
                      </div>

                      <div className="mb-4">
                        <p className="text-xs font-medium text-[#78716C] mb-2">By transitions:</p>
                        <div className="space-y-1">
                          {(company.transitions || []).map((t, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-[#78716C]">
                                {t.moves} move{t.moves > 1 ? 's' : ''}:
                              </span>
                              <span className="font-semibold text-[#1C1917]">
                                {t.count} people
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {(company.years || []).map((year, i) => (
                          <span
                            key={i}
                            className="px-3 py-1 bg-[#F5F5F4] text-[#1C1917] text-sm font-medium rounded-md"
                            style={{ fontFamily: "'JetBrains Mono', monospace" }}
                          >
                            {year}
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </>
            )}
          </div>
        )}

        {activeTab === 'career-transitions' && (
          <div className="text-center py-16">
            <p className="text-[#78716C]">Career Transitions view coming soon...</p>
          </div>
        )}

        {activeTab === 'alumni' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-6 bg-[#F1F5F9] px-6 py-4 rounded-lg">
              <h2 className="text-lg font-semibold text-[#1C1917]">
                Alumni ({filteredAlumni.length})
              </h2>
              <span className="text-sm text-[#78716C]">
                Showing currently {filteredAlumni.length} alumni
              </span>
            </div>

            {loadingAlumni ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="w-10 h-10 text-[#3B82F6] animate-spin" />
              </div>
            ) : (
              <motion.div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              >
                {filteredAlumni.map((person, index) => (
                  <motion.div
                    key={person.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05, duration: 0.4 }}
                    className="bg-white border border-[#E7E5E4] rounded-xl p-6 hover:shadow-md transition-all shadow-sm"
                  >
                    <h3 className="text-lg font-bold text-[#1C1917] mb-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                      {person.name}
                    </h3>
                    <p className="text-sm text-[#78716C] mb-4">
                      Exited {person.exited_year}
                    </p>

                    <div className="space-y-2">
                      {person.path && person.path.length > 0 ? (
                        person.path.map((company, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <div className="w-1 h-1 rounded-full bg-[#78716C] mt-2 flex-shrink-0" />
                            <p className={`text-sm ${i === person.path.length - 1 ? 'text-[#059669] font-medium' : 'text-[#44403C]'}`}>
                              {i === person.path.length - 1 && <span className="mr-1">📍</span>}
                              {company}
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-start gap-2">
                          <div className="w-1 h-1 rounded-full bg-[#78716C] mt-2 flex-shrink-0" />
                          <p className="text-sm text-[#059669] font-medium">
                            📍 {person.current_company}
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}

            {alumni.length === 0 && !loadingAlumni && (
              <div className="text-center py-24">
                <p className="text-[#78716C]">No alumni data found for this period.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'statistics' && (
          <div className="text-center py-16">
            <p className="text-[#78716C]">Statistics view coming soon...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;