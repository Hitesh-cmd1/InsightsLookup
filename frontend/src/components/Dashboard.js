import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, X, ExternalLink, Loader2, LogOut, User as UserIcon, TrendingUp, SlidersHorizontal, Sparkles, Check } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { getOrgTransitions, getEmployeeTransitions, getAlumni, searchOrganizations, getProfile, getDashboardData, getLinkedinOrgIdsByCompanyNames } from '../api/insights';
import { useAuth } from '../context/AuthContext';
import { trackCoreFeatureUsed, incrementActivationCounter } from '../analytics/mixpanel';
import { toast } from 'sonner';

const CONNECTION_FILTERS_STORAGE_KEY = 'insightsConnectionFiltersState';
const DASHBOARD_TOUR_STORAGE_KEY = 'insights_dashboard_tour_seen_v1';
const DASHBOARD_TOUR_STEPS = [
  {
    key: 'context',
    title: 'Find Career Paths',
    description: 'Find where people from your background are getting hired. Enter a company, role, and time period to explore career moves.'
  },
  {
    key: 'filters-group',
    title: 'Search and filter',
    description: 'Search name: Search any company to see if it appears in the transition list. Search role: Filter by role to see which companies hired for this specific position. Year: Select a year to view transitions that happened then. Tip — pick a year close to when you left this company. Transition: See where people go after their 1st, 2nd, or 3rd job after leaving this company.'
  },
  {
    key: 'people-other',
    title: 'People (other transitions)',
    description: 'Count of employees who worked elsewhere after {{company b}}, but eventually landed at {{company a}}.'
  },
  {
    key: 'recent',
    title: 'Recent',
    description: 'Last hired from {{company b}} in {{year}}.'
  },
  {
    key: 'years-list',
    title: 'Years list',
    description: 'Years when {{company a}} hired from {{company b}}.'
  },
  {
    key: 'connections-filter',
    title: 'Filters',
    description: 'Filter companies where you already have connections — from your past workplaces or college.'
  },
  {
    key: 'company-card',
    description: 'Click on this to view people involved in transition or related to your background.'
  },
];

function loadSavedConnectionFiltersState() {
  try {
    const raw = sessionStorage.getItem(CONNECTION_FILTERS_STORAGE_KEY);
    if (!raw) {
      return {
        selectedPastCompanies: [],
        selectedPastRoles: [],
        selectedTenureOptions: [],
        selectedColleges: [],
        selectedDepartments: [],
        selectedBatchOptions: [],
        appliedConnectionFilters: null,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      selectedPastCompanies: Array.isArray(parsed.selectedPastCompanies) ? parsed.selectedPastCompanies : [],
      selectedPastRoles: Array.isArray(parsed.selectedPastRoles) ? parsed.selectedPastRoles : [],
      selectedTenureOptions: Array.isArray(parsed.selectedTenureOptions) ? parsed.selectedTenureOptions : [],
      selectedColleges: Array.isArray(parsed.selectedColleges) ? parsed.selectedColleges : [],
      selectedDepartments: Array.isArray(parsed.selectedDepartments) ? parsed.selectedDepartments : [],
      selectedBatchOptions: Array.isArray(parsed.selectedBatchOptions) ? parsed.selectedBatchOptions : [],
      appliedConnectionFilters: parsed.appliedConnectionFilters && typeof parsed.appliedConnectionFilters === 'object'
        ? parsed.appliedConnectionFilters
        : null,
    };
  } catch {
    return {
      selectedPastCompanies: [],
      selectedPastRoles: [],
      selectedTenureOptions: [],
      selectedColleges: [],
      selectedDepartments: [],
      selectedBatchOptions: [],
      appliedConnectionFilters: null,
    };
  }
}

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
function mapTransitions(apiResult, relatedByDest) {
  if (!apiResult || typeof apiResult !== 'object') {
    return { firstHopCompanies: [], secondHopCompanies: [] };
  }

  const hops = Object.keys(apiResult).filter(k => k !== 'related_by_dest');
  if (hops.length === 0) {
    return { firstHopCompanies: [], secondHopCompanies: [] };
  }

  // related_by_dest: { "org_id_str": { count, related: [...] } }
  const relMap = (relatedByDest && typeof relatedByDest === 'object') ? relatedByDest : {};

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
      const relEntry = relMap[String(entry.organizationId)] || null;
      const relatedCount = relEntry ? ((relEntry.match_count ?? relEntry.count) || 0) : 0;

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
        // Related background: current employees sharing user's org/school background
        relatedCount,
        relatedBackground: relEntry || null,
      });
    });

    // Sort: prioritize people (transition count) as primary sort, 
    // and relatedCount as a secondary tie-breaker.
    cards.sort((a, b) =>
      b.people - a.people ||
      b.relatedCount - a.relatedCount ||
      a.name.localeCompare(b.name)
    );

    // Add rank
    return cards.map((c, idx) => ({ ...c, rank: idx + 1 }));
  }

  const firstHopCompanies = buildCardsForHop(1);
  const secondHopCompanies = buildCardsForHop(2);
  const thirdHopCompanies = buildCardsForHop(3);

  return { firstHopCompanies, secondHopCompanies, thirdHopCompanies };
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
  const savedConnectionFilters = loadSavedConnectionFiltersState();

  const [topCompanyName, setTopCompanyName] = useState(searchParams.companyName || '');
  const [topStartYear, setTopStartYear] = useState(searchParams.startYear || '');
  const [topEndYear, setTopEndYear] = useState(searchParams.endYear || '');
  const [updatingOrgContext, setUpdatingOrgContext] = useState(false);

  const [searchName, setSearchName] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedTransition, setSelectedTransition] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [minTransitions, setMinTransitions] = useState('');
  const [maxTransitions, setMaxTransitions] = useState('');
  const [dataBusinessRoles, setDataBusinessRoles] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [orgSuggestions, setOrgSuggestions] = useState([]);
  const [showOrgSuggestions, setShowOrgSuggestions] = useState(false);
  const [orgSuggestionsLoading, setOrgSuggestionsLoading] = useState(false);
  const [hasTouchedCompanyInput, setHasTouchedCompanyInput] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [activeTab, setActiveTab] = useState('company-pathways');

  const [companiesFirst, setCompaniesFirst] = useState([]);
  const [companiesSecond, setCompaniesSecond] = useState([]);
  const [companiesThird, setCompaniesThird] = useState([]);
  const [alumni, setAlumni] = useState([]);
  const [relatedByDest, setRelatedByDest] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingAlumni, setLoadingAlumni] = useState(false);
  const [error, setError] = useState(null);
  const [totalAlumni, setTotalAlumni] = useState(0);

  // role-based highlighting state
  const [contextRole, setContextRole] = useState(stateFromStorage.role || '');
  const [contextApplying, setContextApplying] = useState(false);
  const [highlightedOrgIds, setHighlightedOrgIds] = useState(new Set());
  const [selectedCards, setSelectedCards] = useState(new Map());
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const { logout } = useAuth();
  // Removed long mockCompanies list
  const years = Array.from({ length: 50 }, (_, i) => new Date().getFullYear() - i);

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [tourPanelPos, setTourPanelPos] = useState({ top: 24, left: 24, width: 420 });
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [searchRoles, setSearchRoles] = useState([]);
  const [roleInput, setRoleInput] = useState('');
  // Multi-select connection filters (arrays). Empty = All/Any for that category.
  const [selectedPastCompanies, setSelectedPastCompanies] = useState(savedConnectionFilters.selectedPastCompanies);
  const [selectedPastRoles, setSelectedPastRoles] = useState(savedConnectionFilters.selectedPastRoles);
  const [selectedTenureOptions, setSelectedTenureOptions] = useState(savedConnectionFilters.selectedTenureOptions);
  const [selectedColleges, setSelectedColleges] = useState(savedConnectionFilters.selectedColleges);
  const [selectedDepartments, setSelectedDepartments] = useState(savedConnectionFilters.selectedDepartments);
  const [selectedBatchOptions, setSelectedBatchOptions] = useState(savedConnectionFilters.selectedBatchOptions);
  // Applied filters sent to API (set when user clicks Done in modal)
  const [appliedConnectionFilters, setAppliedConnectionFilters] = useState(savedConnectionFilters.appliedConnectionFilters);
  const lastFetchKeyRef = useRef(null);
  const transitionsRequestSeqRef = useRef(0);
  const firstTransitionsRef = useRef(null);
  const secondTransitionsRef = useRef(null);
  const thirdTransitionsRef = useRef(null);
  const hasAutoShownTourRef = useRef(false);

  const isProfileEmpty = !profile || !(profile.work_experiences && profile.work_experiences.length > 0);
  const profileCompanies = useMemo(() => {
    const work = profile?.work_experiences;
    if (!work || !Array.isArray(work) || work.length === 0) return [];
    const seen = new Set();
    return work
      .map((e) => e && e.company)
      .filter(Boolean)
      .filter((c) => {
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      });
  }, [profile]);
  const profileRoles = useMemo(() => {
    const work = profile?.work_experiences;
    if (!work || !Array.isArray(work) || work.length === 0) return [];
    const seen = new Set();
    return work
      .map((e) => e && e.role)
      .filter(Boolean)
      .filter((r) => {
        if (seen.has(r)) return false;
        seen.add(r);
        return true;
      });
  }, [profile]);

  const profileColleges = useMemo(() => {
    const educ = profile?.educations;
    if (!educ || !Array.isArray(educ) || educ.length === 0) return [];
    const seen = new Set();
    return educ
      .map((e) => e && e.college)
      .filter(Boolean)
      .filter((c) => {
        if (seen.has(c)) return false;
        seen.add(c);
        return true;
      });
  }, [profile]);

  const profileDepartments = useMemo(() => {
    const educ = profile?.educations;
    if (!educ || !Array.isArray(educ) || educ.length === 0) return [];
    const seen = new Set();
    return educ
      .map((e) => e && e.degree)
      .filter(Boolean)
      .filter((d) => {
        if (seen.has(d)) return false;
        seen.add(d);
        return true;
      });
  }, [profile]);

  const clearAllFilters = () => {
    setSearchName('');
    setSelectedYear('all');
    setSelectedTransition('all');
    setSelectedStatus('all');
    setMinTransitions('');
    setMaxTransitions('');
    setDataBusinessRoles(false);
    setSelectedPastCompanies([]);
    setSelectedPastRoles([]);
    setSelectedTenureOptions([]);
    setSelectedColleges([]);
    setSelectedDepartments([]);
    setSelectedBatchOptions([]);
    setAppliedConnectionFilters(null);
    try {
      sessionStorage.removeItem(CONNECTION_FILTERS_STORAGE_KEY);
    } catch (_) { }
  };

  const getTopCompanyNamesForPerson = (person) => {
    const seen = new Set();
    const names = [];
    const path = Array.isArray(person?.path) ? person.path : [];
    for (const company of path) {
      const value = String(company || '').trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      names.push(value);
      if (names.length >= 2) return names;
    }
    const currentCompany = String(person?.current_company || '').trim();
    if (currentCompany && !seen.has(currentCompany.toLowerCase())) {
      names.push(currentCompany);
    }
    return names.slice(0, 2);
  };

  const buildLinkedInSearchUrl = (name, companyNames = []) => {
    const queryParts = [
      String(name || '').trim(),
      ...companyNames.slice(0, 2).map((c) => String(c || '').trim()).filter(Boolean),
      'linkedin',
    ].filter(Boolean);
    return `https://www.google.com/search?q=${encodeURIComponent(queryParts.join(' '))}`;
  };
  const buildCompanyDetailsUrl = (company, hopValue) => {
    const params = new URLSearchParams();
    if (searchParams.orgId != null) params.set('sourceOrgId', String(searchParams.orgId));
    if (company?.organizationId != null) params.set('destOrgId', String(company.organizationId));
    if (company?.name) params.set('companyName', String(company.name));
    if (hopValue != null) params.set('hop', String(hopValue));
    if (searchParams.startYear) params.set('startYear', String(searchParams.startYear));
    if (searchParams.endYear) params.set('endYear', String(searchParams.endYear));
    if (contextRole) params.set('role', String(contextRole));
    if (appliedConnectionFilters && typeof appliedConnectionFilters === 'object') {
      params.set('cf', JSON.stringify(appliedConnectionFilters));
    }
    return `/company-details?${params.toString()}`;
  };
  const openCompanyDetailsInNewTab = (company, hopValue) => {
    const url = buildCompanyDetailsUrl(company, hopValue);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    try {
      sessionStorage.setItem(
        CONNECTION_FILTERS_STORAGE_KEY,
        JSON.stringify({
          selectedPastCompanies,
          selectedPastRoles,
          selectedTenureOptions,
          selectedColleges,
          selectedDepartments,
          selectedBatchOptions,
          appliedConnectionFilters,
        })
      );
    } catch (_) { }
  }, [
    selectedPastCompanies,
    selectedPastRoles,
    selectedTenureOptions,
    selectedColleges,
    selectedDepartments,
    selectedBatchOptions,
    appliedConnectionFilters,
  ]);

  const buildConnectionFilters = () => {
    const companies = selectedPastCompanies ?? [];
    const roles = selectedPastRoles ?? [];
    const tenure = selectedTenureOptions ?? [];
    const colleges = selectedColleges ?? [];
    const depts = selectedDepartments ?? [];
    const batch = selectedBatchOptions ?? [];
    const hasAny = companies.length > 0 || roles.length > 0 || tenure.length > 0 || colleges.length > 0 || depts.length > 0 || batch.length > 0;
    if (!hasAny) return null;
    return {
      past_companies: companies,
      past_roles: roles,
      tenure_options: tenure,
      colleges,
      departments: depts,
      batch_options: batch,
    };
  };

  const applyFiltersAndClose = () => {
    setAppliedConnectionFilters(buildConnectionFilters());
    setIsFilterOpen(false);
  };

  const handleUpdateTopContext = async (e) => {
    e?.preventDefault();

    const company = (topCompanyName || '').trim();
    if (!company) {
      toast.error('Please enter a company name');
      return;
    }
    if (!topStartYear || !topEndYear) {
      toast.error('Please select both start and end years');
      return;
    }
    if (parseInt(topStartYear, 10) > parseInt(topEndYear, 10)) {
      toast.error('Start year cannot be after end year');
      return;
    }

    setUpdatingOrgContext(true);
    try {
      let resolved = selectedOrg;
      // If the user hasn't explicitly picked from suggestions, fall back to search
      if (!resolved) {
        const orgs = await searchOrganizations(company);
        if (!orgs || orgs.length === 0) {
          toast.error(`No organizations found for "${company}"`);
          return;
        }
        resolved = orgs[0];
      }
      const state = {
        orgId: resolved.id,
        companyName: resolved.name,
        startYear: topStartYear,
        endYear: topEndYear,
      };
      try {
        sessionStorage.setItem('insightsDashboardState', JSON.stringify(state));
      } catch (_) { }
      trackCoreFeatureUsed('company_search_from_dashboard', {
        company_name: resolved.name,
        org_id: resolved.id,
        start_year: topStartYear,
        end_year: topEndYear,
      });
      incrementActivationCounter('company_searches');
      navigate('/dashboard', { state });
    } catch (err) {
      toast.error(err.message || 'Failed to update company and year');
    } finally {
      setUpdatingOrgContext(false);
    }
  };

  // Fetch profile to know if filters can be shown and to build company/role lists
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileLoaded(true);
      return;
    }
    setProfileLoaded(false);
    getProfile()
      .then((data) => {
        setProfile(data);
        setProfileLoaded(true);
      })
      .catch(() => {
        setProfile(null);
        setProfileLoaded(true);
      });
  }, [user]);

  // Debounced company search for suggestions (get_org / organizations API)
  useEffect(() => {
    const q = (topCompanyName || '').trim();
    // Only show suggestions after the user has interacted with the field
    if (!hasTouchedCompanyInput) {
      setOrgSuggestions([]);
      setShowOrgSuggestions(false);
      return;
    }
    if (!q || q.length < 2) {
      setOrgSuggestions([]);
      setShowOrgSuggestions(false);
      return;
    }
    const t = setTimeout(() => {
      setOrgSuggestionsLoading(true);
      searchOrganizations(q)
        .then((list) => {
          setOrgSuggestions(Array.isArray(list) ? list : []);
          setShowOrgSuggestions(true);
        })
        .catch(() => {
          setOrgSuggestions([]);
        })
        .finally(() => setOrgSuggestionsLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [topCompanyName, hasTouchedCompanyInput]);

  // Fetch org-transitions when we have orgId and date range (after profile has loaded to avoid duplicate fetches)
  useEffect(() => {
    const orgId = searchParams.orgId;
    const startYear = searchParams.startYear;
    const endYear = searchParams.endYear;

    if (authLoading || !profileLoaded) return;

    if (!user) {
      openLogin();
      return;
    }

    if (!orgId) {
      setCompaniesFirst([]);
      setCompaniesSecond([]);
      setCompaniesThird([]);
      setTotalAlumni(0);
      setLoading(false);
      setError('Please select an organization to view insights');
      // Proactively navigate home if no context
      if (!location.state) navigate('/');
      return;
    }

    const startDate = startYear ? `${startYear}-01-01` : null;
    const endDate = endYear ? `${endYear}-12-31` : null;
    const useDashboardData = !appliedConnectionFilters && !!(profile?.work_experiences?.length);
    const filtersKey = appliedConnectionFilters ? JSON.stringify(appliedConnectionFilters) : 'none';
    const fetchKey = `${orgId}-${startYear}-${endYear}-${contextRole || ''}-${filtersKey}-${useDashboardData ? 'd' : 't'}`;
    if (lastFetchKeyRef.current === fetchKey) return;
    lastFetchKeyRef.current = fetchKey;
    const requestSeq = ++transitionsRequestSeqRef.current;

    setLoading(true);
    setError(null);

    if (useDashboardData) {
      getDashboardData(orgId, { startDate, endDate, hops: 3, role: contextRole })
        .then((data) => {
          if (requestSeq !== transitionsRequestSeqRef.current) return;
          const transitions = data.transitions || {};
          const relatedByDestData = (typeof data.related_by_dest === 'object' && data.related_by_dest !== null)
            ? data.related_by_dest : {};
          const { firstHopCompanies, secondHopCompanies, thirdHopCompanies } = mapTransitions(transitions, relatedByDestData);
          const first = firstHopCompanies ?? [];
          const second = secondHopCompanies ?? [];
          const third = thirdHopCompanies ?? [];
          setCompaniesFirst(first);
          setCompaniesSecond(second);
          setCompaniesThird(third);
          const total = first.reduce((sum, c) => sum + (c.people || 0), 0);
          setTotalAlumni(total);
          setAlumni(Array.isArray(data.alumni) ? data.alumni : []);
          const highlighted = new Set();
          if (transitions && typeof transitions === 'object') {
            Object.values(transitions).forEach((list) => {
              if (!Array.isArray(list)) return;
              list.forEach((item) => {
                if (!item || item.organization_id == null) return;
                if (item.role_match || item.match) highlighted.add(item.organization_id);
              });
            });
          }
          setHighlightedOrgIds(highlighted);
          setRelatedByDest(relatedByDestData);
          trackCoreFeatureUsed('hiring_pattern_view', { org_id: orgId, start_year: startYear, end_year: endYear, has_role_filter: !!contextRole });
        })
        .catch((err) => {
          if (requestSeq !== transitionsRequestSeqRef.current) return;
          setError(err.message || 'Failed to load dashboard data');
          setCompaniesFirst([]);
          setCompaniesSecond([]);
          setCompaniesThird([]);
          setTotalAlumni(0);
          setAlumni([]);
          setRelatedByDest({});
        })
        .finally(() => {
          if (requestSeq !== transitionsRequestSeqRef.current) return;
          setLoading(false);
        });
      return;
    }

    getOrgTransitions(orgId, { startDate, endDate, hops: 3, role: contextRole, connectionFilters: appliedConnectionFilters, includeRelated: true })
      .then((data) => {
        if (requestSeq !== transitionsRequestSeqRef.current) return;
        const relatedByDestData = (typeof data.related_by_dest === 'object' && data.related_by_dest !== null)
          ? data.related_by_dest : {};
        const { firstHopCompanies, secondHopCompanies, thirdHopCompanies } = mapTransitions(data, relatedByDestData);
        const first = firstHopCompanies ?? [];
        const second = secondHopCompanies ?? [];
        const third = thirdHopCompanies ?? [];
        setCompaniesFirst(first);
        setCompaniesSecond(second);
        setCompaniesThird(third);
        const total = first.reduce((sum, c) => sum + (c.people || 0), 0);
        setTotalAlumni(total);
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
        setRelatedByDest(relatedByDestData);
        trackCoreFeatureUsed('hiring_pattern_view', { org_id: orgId, start_year: startYear, end_year: endYear, has_role_filter: !!contextRole });
      })
      .catch((err) => {
        if (requestSeq !== transitionsRequestSeqRef.current) return;
        setError(err.message || 'Failed to load transitions');
        setCompaniesFirst([]);
        setCompaniesSecond([]);
        setCompaniesThird([]);
        setTotalAlumni(0);
        setRelatedByDest({});
      })
      .finally(() => {
        if (requestSeq !== transitionsRequestSeqRef.current) return;
        setLoading(false);
      });
  }, [searchParams.orgId, searchParams.startYear, searchParams.endYear, contextRole, appliedConnectionFilters, profile, profileLoaded, user, openLogin, authLoading, location.state, navigate]);

  // Fetch alumni when the tab is active
  useEffect(() => {
    if (activeTab !== 'alumni' || !searchParams.orgId) return;

    setLoadingAlumni(true);
    const startDate = searchParams.startYear ? `${searchParams.startYear}-01-01` : null;
    const endDate = searchParams.endYear ? `${searchParams.endYear}-12-31` : null;

    getAlumni(searchParams.orgId, { startDate, endDate, connectionFilters: appliedConnectionFilters })
      .then((data) => {
        setAlumni(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error('Failed to load alumni', err);
      })
      .finally(() => setLoadingAlumni(false));
  }, [activeTab, searchParams.orgId, searchParams.startYear, searchParams.endYear, appliedConnectionFilters]);

  // Client-side filter by search name (and other filters if needed)
  const applyCommonFilters = (list) => {
    let next = Array.isArray(list) ? list : [];
    if ((searchName || '').trim()) {
      const q = (searchName || '').toLowerCase();
      next = next.filter((c) => c && String(c.name || '').toLowerCase().includes(q));
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

  // When a role is set, only show companies that hired into that role (role_match from API)
  const filterByRoleMatch = (list) => {
    const role = (contextRole || '').trim();
    if (!role) return Array.isArray(list) ? list : [];
    return (Array.isArray(list) ? list : []).filter((c) => highlightedOrgIds.has(c.organizationId));
  };
  const isConnectionFilterActive = !!appliedConnectionFilters;
  const prioritizeFilterMatches = (list) => {
    const base = Array.isArray(list) ? [...list] : [];
    if (!isConnectionFilterActive) return base;
    base.sort((a, b) =>
      Number((b.relatedCount || 0) > 0) - Number((a.relatedCount || 0) > 0) ||
      (b.relatedCount || 0) - (a.relatedCount || 0) ||
      (a.rank || 0) - (b.rank || 0)
    );
    return base.map((c, idx) => ({ ...c, rank: idx + 1 }));
  };

  const filteredCompaniesFirst = prioritizeFilterMatches(filterByRoleMatch(applyCommonFilters(companiesFirst ?? [])));
  const filteredCompaniesSecond = prioritizeFilterMatches(filterByRoleMatch(applyCommonFilters(companiesSecond ?? [])));
  const filteredCompaniesThird = prioritizeFilterMatches(filterByRoleMatch(applyCommonFilters(companiesThird ?? [])));
  const appliedFiltersCount = useMemo(() => {
    if (!appliedConnectionFilters || typeof appliedConnectionFilters !== 'object') return 0;
    const keys = ['past_companies', 'past_roles', 'tenure_options', 'colleges', 'departments', 'batch_options'];
    return keys.reduce((acc, k) => {
      const v = appliedConnectionFilters[k];
      return acc + (Array.isArray(v) ? v.length : 0);
    }, 0);
  }, [appliedConnectionFilters]);

  const matchedCompaniesCount = useMemo(() => {
    if (!isConnectionFilterActive) return 0;
    const matched = new Set();
    [...filteredCompaniesFirst, ...filteredCompaniesSecond, ...filteredCompaniesThird].forEach((c) => {
      if ((c?.relatedCount || 0) > 0 && c?.organizationId != null) matched.add(c.organizationId);
    });
    return matched.size;
  }, [isConnectionFilterActive, filteredCompaniesFirst, filteredCompaniesSecond, filteredCompaniesThird]);
  const totalVisibleCompaniesCount = useMemo(() => {
    const visible = new Set();
    [...filteredCompaniesFirst, ...filteredCompaniesSecond, ...filteredCompaniesThird].forEach((c) => {
      if (c?.organizationId != null) visible.add(c.organizationId);
    });
    return visible.size;
  }, [filteredCompaniesFirst, filteredCompaniesSecond, filteredCompaniesThird]);
  const scrollToTransitions = (which) => {
    const ref = which === 1 ? firstTransitionsRef : which === 2 ? secondTransitionsRef : thirdTransitionsRef;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (hasAutoShownTourRef.current || authLoading) return;
    hasAutoShownTourRef.current = true;
    try {
      const seen = localStorage.getItem(DASHBOARD_TOUR_STORAGE_KEY);
      if (seen === '1') return;
    } catch (_) { }
    setTourOpen(true);
    setTourStep(0);
  }, [authLoading]);

  useEffect(() => {
    if (!tourOpen) return;
    const step = DASHBOARD_TOUR_STEPS[tourStep];
    if (!step) return;
    if (['company-card', 'people-first', 'people-other', 'recent', 'years-list'].includes(step.key) && activeTab !== 'company-pathways') {
      setActiveTab('company-pathways');
      return;
    }
    const t = setTimeout(() => {
      const node = document.querySelector(`[data-tour="${step.key}"]`);
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [tourOpen, tourStep, activeTab]);

  useEffect(() => {
    if (!tourOpen) return;

    const updatePanelPosition = () => {
      const step = DASHBOARD_TOUR_STEPS[tourStep];
      const node = step ? document.querySelector(`[data-tour="${step.key}"]`) : null;
      const panelWidth = Math.min(420, Math.max(320, window.innerWidth - 32));

      if (!node || typeof node.getBoundingClientRect !== 'function') {
        setTourPanelPos({ top: 24, left: Math.max(16, window.innerWidth - panelWidth - 16), width: panelWidth });
        return;
      }

      const rect = node.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const gap = 14;
      const panelH = 220;

      let left = rect.right + gap;
      if (left + panelWidth > viewportW - 16) {
        left = rect.left - panelWidth - gap;
      }
      if (left < 16) {
        left = Math.max(16, viewportW - panelWidth - 16);
      }

      let top = rect.top + (rect.height / 2) - (panelH / 2);
      if (top < 16) top = 16;
      if (top + panelH > viewportH - 16) top = viewportH - panelH - 16;

      setTourPanelPos({ top, left, width: panelWidth });
    };

    const t = setTimeout(updatePanelPosition, 140);
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [tourOpen, tourStep, activeTab, filteredCompaniesFirst]);

  const isTourTarget = (key) => tourOpen && DASHBOARD_TOUR_STEPS[tourStep]?.key === key;
  const sourceCompany = (topCompanyName || searchParams.companyName || 'company b').trim();
  const targetCompany = String(filteredCompaniesFirst?.[0]?.name || 'company a').trim();
  const recentYearForTour = String(filteredCompaniesFirst?.[0]?.recent || 'year');
  const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const renderHighlightedTourText = (value) => {
    const text = String(value || '');
    const tokens = [sourceCompany, targetCompany, recentYearForTour]
      .map((t) => String(t || '').trim())
      .filter(Boolean);
    const uniqueTokens = Array.from(new Set(tokens));
    const tokenPattern = [
      ...uniqueTokens
        .sort((a, b) => b.length - a.length)
        .map((t) => escapeRegex(t)),
      '\\b(?:19|20)\\d{2}\\b',
    ].join('|');
    if (!tokenPattern) return text;
    const regex = new RegExp(`(${tokenPattern})`, 'gi');
    return text.split(regex).map((part, idx) => {
      if (!part) return null;
      const normalized = part.toLowerCase();
      const isToken = uniqueTokens.some((t) => t.toLowerCase() === normalized);
      const isYear = /\b(?:19|20)\d{2}\b/.test(part);
      if (isToken || isYear) {
        return (
          <span
            key={`${part}-${idx}`}
            className="inline-flex items-center rounded-md bg-[#FEF3C7] text-[#92400E] font-semibold px-1.5 py-0.5 mx-0.5"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={`${part}-${idx}`}>{part}</React.Fragment>;
    });
  };
  const getTourDescription = () => {
    const raw = String(DASHBOARD_TOUR_STEPS[tourStep]?.description || '');
    return raw
      .replaceAll('{{company b}}', sourceCompany)
      .replaceAll('{{company a}}', targetCompany)
      .replaceAll('{{year}}', recentYearForTour);
  };
  const startTour = () => {
    setTourOpen(true);
    setTourStep(0);
  };
  const closeTour = () => {
    setTourOpen(false);
    setTourStep(0);
    try {
      localStorage.setItem(DASHBOARD_TOUR_STORAGE_KEY, '1');
    } catch (_) { }
  };
  const nextTourStep = () => {
    if (tourStep >= DASHBOARD_TOUR_STEPS.length - 1) {
      closeTour();
      return;
    }
    setTourStep((prev) => prev + 1);
  };
  const prevTourStep = () => setTourStep((prev) => Math.max(0, prev - 1));

  const isOrgHighlighted = (orgId) => highlightedOrgIds.has(orgId);
  const buildCardSelectionKey = (hop, company, index) => `${hop}:${company?.organizationId ?? company?.name ?? index}`;
  const isCardSelected = (hop, company, index) => selectedCards.has(buildCardSelectionKey(hop, company, index));
  const toggleCardSelected = (hop, company, index) => {
    const key = buildCardSelectionKey(hop, company, index);
    const name = String(company?.name || '').trim();
    setSelectedCards((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, name);
      return next;
    });
  };
  const clearSelectedCards = () => setSelectedCards(new Map());
  const selectedCompanyNames = useMemo(() => {
    const names = [];
    const seen = new Set();
    for (const value of selectedCards.values()) {
      const n = String(value || '').trim();
      const k = n.toLowerCase();
      if (!n || seen.has(k)) continue;
      seen.add(k);
      names.push(n);
    }
    return names;
  }, [selectedCards]);
  const selectedCount = selectedCards.size;
  const isSelectionMode = selectedCount > 0;
  const selectedPreview = selectedCompanyNames.slice(0, 3).join(', ');
  const selectedOverflow = Math.max(0, selectedCompanyNames.length - 3);
  const selectedSummaryText = selectedPreview
    ? `${selectedPreview}${selectedOverflow > 0 ? ` +${selectedOverflow} more` : ''}`
    : `${selectedCount} selected`;
  const buildKeywordsFromRoles = (roles = []) => {
    const tags = (Array.isArray(roles) ? roles : [])
      .map((r) => String(r || '').trim())
      .filter(Boolean);
    if (tags.length === 0) return '';
    if (tags.length === 1) return tags[0];
    return tags.join(' OR ');
  };
  const openLinkedInJobsForSelection = async (roles = []) => {
    const keywords = buildKeywordsFromRoles(roles);
    try {
      const data = await getLinkedinOrgIdsByCompanyNames(selectedCompanyNames);
      const ids = Array.isArray(data?.linkedin_org_ids)
        ? data.linkedin_org_ids
          .map((v) => String(v || '').trim())
          .filter((v) => /^\d+$/.test(v))
        : [];

      const params = new URLSearchParams();
      if (keywords) params.set('keywords', keywords);
      params.set('f_TPR', 'r2592000');
      if (ids.length > 0) params.set('f_C', ids.join(','));
      const q = params.toString();
      const url = `https://www.linkedin.com/jobs/search-results/${q ? `?${q}` : ''}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      setIsRoleModalOpen(false);
      setRoleInput('');
    } catch (err) {
      toast.error(err.message || 'Could not open LinkedIn jobs');
    }
  };

  // Filter alumni list
  const filteredAlumni = useMemo(() => {
    let next = Array.isArray(alumni) ? alumni : [];
    if ((searchName || '').trim()) {
      next = next.filter((a) => (a && a.name && String(a.name).toLowerCase().includes((searchName || '').toLowerCase())));
    }
    return next;
  }, [alumni, searchName]);

  const applyRoleContext = async () => {
    const role = (contextRole || '').trim();

    if (role && searchParams.orgId) {
      incrementActivationCounter('role_filters_applied');
    }

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

      const { firstHopCompanies, secondHopCompanies, thirdHopCompanies } = mapTransitions(data);
      const first = firstHopCompanies ?? [];
      const second = secondHopCompanies ?? [];
      const third = thirdHopCompanies ?? [];
      setCompaniesFirst(first);
      setCompaniesSecond(second);
      setCompaniesThird(third);

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
      {tourOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-[#1C1917]/35 pointer-events-none" />
          <div
            className="fixed z-[80] rounded-2xl border border-[#E7E5E4] bg-white p-5 shadow-xl"
            style={{ top: `${tourPanelPos.top}px`, left: `${tourPanelPos.left}px`, width: `${tourPanelPos.width}px` }}
          >
            <p className="text-xs uppercase tracking-wide text-[#A8A29E]">
              Step {tourStep + 1} of {DASHBOARD_TOUR_STEPS.length}
            </p>
            <h3 className="mt-1 text-lg font-bold text-[#1C1917]">{DASHBOARD_TOUR_STEPS[tourStep].title}</h3>
            {DASHBOARD_TOUR_STEPS[tourStep]?.key === 'filters-group' ? (
              <div className="mt-2 space-y-2 text-sm text-[#57534E]">
                <p><span className="font-semibold text-[#1C1917]">Search name:</span> Search any company to see if it appears in the transition list.</p>
                <p><span className="font-semibold text-[#1C1917]">Search role:</span> Filter by role to see which companies hired for this specific position.</p>
                <p><span className="font-semibold text-[#1C1917]">Year:</span> Select a year to view transitions that happened then. Tip — pick a year close to when you left this company.</p>
                <p><span className="font-semibold text-[#1C1917]">Transition:</span> See where people go after their 1st, 2nd, or 3rd job after leaving this company.</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-[#57534E]">{renderHighlightedTourText(getTourDescription())}</p>
            )}
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={closeTour}
                className="text-sm text-[#78716C] hover:text-[#1C1917] transition-colors"
              >
                Skip tour
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={prevTourStep}
                  disabled={tourStep === 0}
                  className="h-10 px-4 rounded-full border border-[#E7E5E4] text-sm font-medium text-[#1C1917] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={nextTourStep}
                  className="h-10 px-5 rounded-full bg-[#1C1917] text-sm font-semibold text-[#FAFAF9]"
                >
                  {tourStep === DASHBOARD_TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Header */}
      <header className="bg-white border-b border-[#E7E5E4] sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate('/')}
            >
              <div className="w-8 h-8 bg-[#1C1917] rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <span
                className="text-xl font-bold text-[#1C1917]"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Insights
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            {!tourOpen && (
              <button
                type="button"
                onClick={startTour}
                title="Start product tour"
                aria-label="Start product tour"
                className="group h-10 w-10 hover:w-32 hover:-translate-x-1 rounded-full border border-[#E7E5E4] bg-white shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden flex items-center"
              >
                <span className="w-10 h-10 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-[#F59E0B]" />
                </span>
                <span className="text-sm font-semibold text-[#1C1917] whitespace-nowrap max-w-0 opacity-0 group-hover:max-w-[88px] group-hover:opacity-100 transition-all duration-300">
                  start tour
                </span>
              </button>
            )}
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
                            setIsProfileMenuOpen(false);
                            navigate('/profile');
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#1C1917] hover:bg-[#F5F5F4] rounded-lg transition-all"
                        >
                          <UserIcon className="w-4 h-4" />
                          Profile
                        </button>
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

      {/* Company + tenure summary */}
      <div className="bg-white border-b border-[#E7E5E4]">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div
            className={`bg-[#F9FAFB] border border-[#E7E5E4] rounded-2xl px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 ${isTourTarget('context') ? 'relative z-[70] ring-4 ring-[#F59E0B]/50' : ''}`}
            data-tour="context"
          >
            <div className="space-y-2 text-sm text-[#44403C]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#78716C]">
                Career transitions context
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span>Career transitions of</span>
                <div className="relative min-w-[200px]">
                  <input
                    type="text"
                    value={topCompanyName}
                    onChange={(e) => {
                      setHasTouchedCompanyInput(true);
                      setSelectedOrg(null);
                      setTopCompanyName(e.target.value);
                    }}
                    onFocus={() => {
                      setHasTouchedCompanyInput(true);
                      if (orgSuggestions.length > 0) setShowOrgSuggestions(true);
                    }}
                    onBlur={() => setTimeout(() => setShowOrgSuggestions(false), 180)}
                    placeholder="Search company..."
                    className="h-9 w-full px-3 rounded-full border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                  />
                  {orgSuggestionsLoading && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 text-[#78716C] animate-spin" />
                    </span>
                  )}
                  {showOrgSuggestions && orgSuggestions.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full mt-1 py-1 bg-white border border-[#E7E5E4] rounded-xl shadow-lg z-50 max-h-56 overflow-auto">
                      {orgSuggestions.map((org) => (
                        <li key={org.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setSelectedOrg(org);
                              setTopCompanyName(org.name);
                              setShowOrgSuggestions(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-[#1C1917] hover:bg-[#F5F5F4] flex justify-between items-center"
                          >
                            <span>{org.name}</span>
                            {org.alumni_count != null && (
                              <span className="text-xs text-[#78716C]">{org.alumni_count} alumni</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <span>alumni who left between</span>
                <select
                  value={topStartYear || ''}
                  onChange={(e) => setTopStartYear(e.target.value)}
                  className="h-9 px-3 rounded-full border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                >
                  <option value="">Start year</option>
                  {years.map((year) => (
                    <option key={`top-start-${year}`} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <span>and</span>
                <select
                  value={topEndYear || ''}
                  onChange={(e) => setTopEndYear(e.target.value)}
                  className="h-9 px-3 rounded-full border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                >
                  <option value="">End year</option>
                  {years.map((year) => (
                    <option key={`top-end-${year}`} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs text-[#78716C]">Alumni in this view</p>
                <p
                  className="text-2xl font-bold text-[#1C1917]"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {totalAlumni}
                </p>
              </div>
              <button
                type="button"
                onClick={handleUpdateTopContext}
                disabled={updatingOrgContext}
                className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-[#1C1917] text-xs font-semibold text-white hover:bg-[#292524] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                {updatingOrgContext ? 'Updating...' : 'Update view'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky top-[73px] z-30">
        {/* Filters */}
        <div className="bg-white border-b border-[#E7E5E4]">
          <div className="max-w-[1600px] mx-auto px-6 py-4">
            <div className="flex flex-wrap gap-3 items-center">
              <div
                className={`flex flex-wrap gap-3 items-center ${isTourTarget('filters-group') ? 'relative z-[60] ring-4 ring-[#F59E0B]/45 rounded-xl p-2 -m-2' : ''}`}
                data-tour="filters-group"
              >
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
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedYear(v);
                    if (v !== 'all') incrementActivationCounter('year_filter_applied');
                  }}
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
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedTransition(v);
                    if (v !== 'all') incrementActivationCounter('transition_filter_applied');
                  }}
                  className="px-3 py-2 border border-[#E7E5E4] rounded-lg text-sm focus:outline-none focus:border-[#1C1917] bg-white cursor-pointer"
                  data-testid="transition-filter"
                >
                  <option value="all">All Transitions</option>
                  <option value="1">1 Transition</option>
                  <option value="2">2 Transitions</option>
                  <option value="3+">3+ Transitions</option>
                </select>
              </div>

              {/* Advanced Connections Filter */}
              <button
                type="button"
                onClick={() => {
                  setIsFilterOpen(true);
                  incrementActivationCounter('connections_filter_opened');
                }}
                className={`inline-flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${isConnectionFilterActive
                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                  : 'border-[#E7E5E4] text-[#1C1917] bg-white hover:bg-[#F5F5F4]'
                  } ${isTourTarget('connections-filter') ? 'relative z-[70] ring-4 ring-[#F59E0B]/55' : ''}`}
                data-tour="connections-filter"
              >
                <SlidersHorizontal className={`w-4 h-4 ${isConnectionFilterActive ? 'text-white/70' : 'text-[#78716C]'}`} />
                Filters
                {isConnectionFilterActive && appliedFiltersCount > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full text-xs font-bold w-5 h-5 bg-[#3B82F6] text-white">
                    {appliedFiltersCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  incrementActivationCounter('clear_filters_clicks');
                  clearAllFilters();
                }}
                className="ml-auto text-sm text-[#3B82F6] hover:underline"
                data-testid="clear-all-button"
              >
                Clear All
              </button>
              <span className="text-sm text-[#78716C]">
                {isConnectionFilterActive
                  ? `${matchedCompaniesCount}/${totalVisibleCompaniesCount} companies matched`
                  : `Showing ${totalVisibleCompaniesCount} companies`}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          className={`bg-white border-b border-[#E7E5E4] ${isTourTarget('tabs') ? 'relative z-[60] ring-4 ring-[#F59E0B]/45' : ''}`}
          data-tour="tabs"
        >
          <div className="max-w-[1600px] mx-auto px-6">
            <div className="flex gap-8">
              <button
                onClick={() => {
                  if (activeTab !== 'company-pathways') incrementActivationCounter('tabs_switched');
                  setActiveTab('company-pathways');
                }}
                className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'company-pathways'
                  ? 'border-[#3B82F6] text-[#3B82F6]'
                  : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                  }`}
                data-testid="company-pathways-tab"
              >
                Company Pathways
              </button>
              <button
                onClick={() => {
                  if (activeTab !== 'career-transitions') incrementActivationCounter('tabs_switched');
                  setActiveTab('career-transitions');
                }}
                className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'career-transitions'
                  ? 'border-[#3B82F6] text-[#3B82F6]'
                  : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                  }`}
                data-testid="career-transitions-tab"
              >
                Career Transitions
              </button>
              <button
                onClick={() => {
                  if (activeTab !== 'alumni') incrementActivationCounter('tabs_switched');
                  setActiveTab('alumni');
                }}
                className={`py-4 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'alumni'
                  ? 'border-[#3B82F6] text-[#3B82F6]'
                  : 'border-transparent text-[#78716C] hover:text-[#1C1917]'
                  }`}
                data-testid="alumni-tab"
              >
                Alumni ({totalAlumni})
              </button>
              <button
                onClick={() => {
                  if (activeTab !== 'statistics') incrementActivationCounter('tabs_switched');
                  setActiveTab('statistics');
                }}
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
      </div>

      {/* Connections filter modal */}
      <AnimatePresence>
        {isFilterOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
          >
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="max-w-4xl w-full mx-4 bg-white border border-[#E7E5E4] rounded-2xl shadow-xl overflow-hidden"
            >
              <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#E7E5E4]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#3B82F6]">
                    Advanced Connections
                  </p>
                  <p className="mt-1 text-sm text-[#78716C] max-w-xl">
                    We'll highlight companies where people like you are working so you can get warm intros.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFilterOpen(false)}
                  className="p-1.5 rounded-full hover:bg-[#F5F5F4] text-[#78716C]"
                  aria-label="Close filters"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative px-6 py-5">
                {isProfileEmpty && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-b-2xl">
                    <div className="max-w-md mx-4 text-center px-6 py-8">
                      <p className="text-lg font-semibold text-[#1C1917]">
                        Add your profile to use advanced filters.
                      </p>
                      <p className="mt-3 text-sm text-[#57534E]">
                        Add your work history and education so we can show which companies have people with similar backgrounds.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsFilterOpen(false);
                          navigate('/profile');
                        }}
                        className="mt-5 inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-[#1C1917] text-sm font-semibold text-white hover:bg-[#292524] transition-all"
                      >
                        Go to Profile
                      </button>
                    </div>
                  </div>
                )}
                <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${isProfileEmpty ? 'select-none pointer-events-none blur-md opacity-50' : ''}`}>
                  {/* Past Company Connections */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E]" />
                      <h3 className="text-sm font-semibold text-[#1C1917]">
                        Work history
                      </h3>
                    </div>
                    <p className="text-xs text-[#78716C]">
                      Find ex-colleagues who are working at these companies.
                    </p>

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium text-[#57534E] mb-2">Past company (multi-select)</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedPastCompanies([])}
                            className="px-3 py-1.5 rounded-full border text-xs font-medium bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]"
                          >
                            All
                          </button>
                          {(profileCompanies ?? []).map((company) => {
                            const selected = (selectedPastCompanies ?? []).includes(company);
                            return (
                              <button
                                key={company}
                                type="button"
                                onClick={() => setSelectedPastCompanies(prev => {
                                  const p = prev ?? [];
                                  return p.includes(company) ? p.filter((c) => c !== company) : [...p, company];
                                })}
                                className={`px-3 py-1.5 rounded-full border text-xs font-medium ${selected
                                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                                  : 'bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                  }`}
                              >
                                {company}
                              </button>
                            );
                          })}
                          {!isProfileEmpty && (profileCompanies ?? []).length === 0 && (
                            <span className="text-xs text-[#78716C]">Add companies in your profile</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-[#57534E] mb-2">Job title(multi-select)</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedPastRoles([])}
                            className="px-3 py-1.5 rounded-full border text-xs font-medium bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]"
                          >
                            Any Role
                          </button>
                          {(profileRoles ?? []).map((role) => {
                            const selected = (selectedPastRoles ?? []).includes(role);
                            return (
                              <button
                                key={role}
                                type="button"
                                onClick={() => setSelectedPastRoles(prev => {
                                  const p = prev ?? [];
                                  return p.includes(role) ? p.filter((r) => r !== role) : [...p, role];
                                })}
                                className={`px-3 py-1.5 rounded-full border text-xs font-medium ${selected
                                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                                  : 'bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                  }`}
                              >
                                {role}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-[#57534E] mb-2">Tenure (multi-select)</p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { id: 'with-me', label: 'Worked with me', title: 'Any person with matching or overlapping tenure' },
                            { id: 'near-me', label: 'Near my time', title: 'People who exited up to 2 years before your start or up to 2 years after your end date' },
                            { id: 'any-time', label: 'Anytime', title: 'No tenure restriction' },
                          ].map(({ id, label, title }) => {
                            const selected = (selectedTenureOptions ?? []).includes(id);
                            return (
                              <button
                                key={id}
                                type="button"
                                title={title}
                                onClick={() => setSelectedTenureOptions(prev => {
                                  const p = prev ?? [];
                                  return p.includes(id) ? p.filter((t) => t !== id) : [...p, id];
                                })}
                                className={`px-3 py-1.5 rounded-full border text-xs font-medium ${selected
                                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                                  : 'bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                  }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-[#78716C] mt-1.5">
                          Worked with me: overlapping tenure. Near my time: exited within 2 years of your stint. Anytime: no restriction.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Education */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#EF4444]" />
                      <h3 className="text-sm font-semibold text-[#1C1917]">
                        Education
                      </h3>
                    </div>
                    <p className="text-xs text-[#78716C]">
                      Find batchmates and alumni at these companies.
                    </p>

                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium text-[#57534E] mb-2">College / university (multi-select)</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedColleges([])}
                            className="px-3 py-1.5 rounded-full border text-xs font-medium bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]"
                          >
                            All
                          </button>
                          {(profileColleges ?? []).map((college) => {
                            const selected = (selectedColleges ?? []).includes(college);
                            const label = (college && college.length > 22) ? `${String(college).slice(0, 22)}…` : (college ?? '');
                            return (
                              <button
                                key={college}
                                type="button"
                                title={college}
                                onClick={() => setSelectedColleges(prev => {
                                  const p = prev ?? [];
                                  return p.includes(college) ? p.filter((c) => c !== college) : [...p, college];
                                })}
                                className={`px-3 py-1.5 rounded-full border text-xs font-medium ${selected
                                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                                  : 'bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                  }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-[#57534E] mb-2">Department (multi-select)</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedDepartments([])}
                            className="px-3 py-1.5 rounded-full border text-xs font-medium bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]"
                          >
                            Any Department
                          </button>
                          {(profileDepartments ?? []).map((dept) => {
                            const selected = (selectedDepartments ?? []).includes(dept);
                            const label = (dept && dept.length > 22) ? `${String(dept).slice(0, 22)}…` : (dept ?? '');
                            return (
                              <button
                                key={dept}
                                type="button"
                                title={dept}
                                onClick={() => setSelectedDepartments(prev => {
                                  const p = prev ?? [];
                                  return p.includes(dept) ? p.filter((d) => d !== dept) : [...p, dept];
                                })}
                                className={`px-3 py-1.5 rounded-full border text-xs font-medium ${selected
                                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                                  : 'bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                  }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-medium text-[#57534E] mb-2">Batch (multi-select)</p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { id: 'exact', label: 'Batchmates' },
                            { id: 'close', label: 'Close batch' },
                            { id: 'any', label: 'Any batch' },
                          ].map(({ id, label }) => {
                            const selected = (selectedBatchOptions ?? []).includes(id);
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setSelectedBatchOptions(prev => {
                                  const p = prev ?? [];
                                  return p.includes(id) ? p.filter((b) => b !== id) : [...p, id];
                                })}
                                className={`px-3 py-1.5 rounded-full border text-xs font-medium ${selected
                                  ? 'bg-[#1C1917] text-white border-[#1C1917]'
                                  : 'bg-white text-[#1C1917] border-[#E7E5E4] hover:bg-[#F5F5F4]'
                                  }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-[#78716C] mt-1.5">
                          Batchmates: same start and end dates. Close batch: ±4 years from start year. Any batch: no restriction.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-[#E7E5E4] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#F9FAFB]">
                <p className="text-xs text-[#57534E] max-w-xl">
                  Highlights companies where matches exist — doesn't change the list.
                </p>
                {isProfileEmpty ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsFilterOpen(false);
                      navigate('/profile');
                    }}
                    className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-[#1C1917] text-xs font-semibold text-white hover:bg-[#292524] transition-all"
                  >
                    Go to Profile
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPastCompanies([]);
                        setSelectedPastRoles([]);
                        setSelectedTenureOptions([]);
                        setSelectedColleges([]);
                        setSelectedDepartments([]);
                        setSelectedBatchOptions([]);
                        setAppliedConnectionFilters(null);
                        lastFetchKeyRef.current = null;
                        setIsFilterOpen(false);
                      }}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-[#E7E5E4] bg-white text-xs font-semibold text-[#1C1917] hover:bg-[#F5F5F4] transition-all"
                    >
                      Clear filters
                    </button>
                    <button
                      type="button"
                      onClick={applyFiltersAndClose}
                      className="inline-flex items-center justify-center px-4 py-2 rounded-full bg-[#1C1917] text-xs font-semibold text-white hover:bg-[#292524] transition-all"
                    >
                      Apply filters
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className={`max-w-[1600px] mx-auto px-6 py-8 ${selectedCount > 0 ? 'pb-32' : ''}`}>
        {activeTab === 'company-pathways' && (
          <div>
            {/* Section Header */}
            <div ref={firstTransitionsRef} className="flex items-center justify-between mb-6 bg-[#DBEAFE] px-6 py-4 rounded-lg">
              <h2 className="text-lg font-semibold text-[#1C1917]">
                1st Transitions
              </h2>
              <span className="text-sm text-[#78716C]">
                {(filteredCompaniesFirst ?? []).length} companies
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
                      whileHover={isSelectionMode ? undefined : { y: -4 }}
                      className={`relative overflow-hidden bg-white border ${(isOrgHighlighted(company.organizationId) || (appliedConnectionFilters && company.relatedCount > 0))
                        ? 'border-[#3B82F6] ring-2 ring-[#3B82F6]/100'
                        : 'border-[#E7E5E4]'
                        } rounded-xl p-6 hover:shadow-md transition-all ${isSelectionMode ? 'cursor-default' : 'cursor-pointer'} ${(isTourTarget('company-card') && index === 0) ? 'relative z-[60] ring-4 ring-[#F59E0B]/50' : ''} ${isCardSelected(1, company, index) ? 'shadow-[inset_0_0_0_2px_rgba(59,130,246,0.45)]' : ''}`}
                      data-tour={index === 0 ? 'company-card' : undefined}
                      data-testid={`company-card-${company.rank}`}
                      onClick={() => {
                        if (isSelectionMode) return;
                        incrementActivationCounter('company_card_clicks', false);
                        incrementActivationCounter('company_cards_opened');
                        trackCoreFeatureUsed('company_card_opened', { hop: 1, company_name: company.name, dest_org_id: company.organizationId });
                        openCompanyDetailsInNewTab(company, 1);
                      }}
                    >
                      <div className={`absolute left-0 top-0 h-full ${isCardSelected(1, company, index) ? 'w-2 bg-[#3B82F6]' : 'w-px bg-[#E7E5E4]'}`} />
                      {/* Rank Badge + Related Badge */}
                      <div className="flex items-center gap-2 mb-3">
                        <div className="inline-flex items-center justify-center bg-[#3B82F6] text-white text-sm font-bold rounded px-2 py-1">
                          #{company.rank}
                        </div>
                        {company.relatedCount > 0 && (
                          <div className="inline-flex items-center gap-1 bg-[#DCFCE7] text-[#15803D] text-xs font-semibold rounded-full px-2.5 py-1">
                            <span>👥</span>
                            <span>{company.relatedCount} connection{company.relatedCount !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCardSelected(1, company, index);
                          }}
                          className={`ml-auto w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${isCardSelected(1, company, index)
                            ? 'bg-[#3B82F6] border-[#3B82F6] ring-1 ring-[#93C5FD]'
                            : 'bg-white border-[#60A5FA] hover:border-[#3B82F6] ring-1 ring-[#DBEAFE]'
                            }`}
                          aria-label={isCardSelected(1, company, index) ? 'Unselect card' : 'Select card'}
                        >
                          {isCardSelected(1, company, index) && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
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
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isSelectionMode) e.preventDefault();
                              }}
                              className={`flex items-center gap-1 group ${isSelectionMode ? 'pointer-events-none opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            >
                          {/* Icon */}
                          <ExternalLink
                            className="
                                w-4 h-4 text-gray-500
                                transition-all duration-200
                                group-hover:-translate-x-1
                              "
                          />

                          {/* Careers text */}
                          <span
                            className="
                                text-sm text-gray-600
                                opacity-0 max-w-0 overflow-hidden
                                transition-all duration-200
                                group-hover:opacity-100 group-hover:max-w-[80px]
                              "
                          >
                            Careers
                          </span>
                        </a>

                      </div>

                      {/* People and Recent */}
                      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
                        <div
                          className={`${isTourTarget('people-first') && index === 0 ? 'rounded-lg ring-4 ring-[#F59E0B]/45 p-2 -m-2' : ''}`}
                          data-tour={index === 0 ? 'people-first' : undefined}
                        >
                          <p className="text-xs text-[#78716C] mb-1">People (1st transition only):</p>
                          <p className="text-xl font-bold text-[#1C1917]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {company.people}
                          </p>
                        </div>
                        <div
                          className={`${isTourTarget('people-other') && index === 0 ? 'rounded-lg ring-4 ring-[#F59E0B]/45 p-2 -m-2' : ''}`}
                          data-tour={index === 0 ? 'people-other' : undefined}
                        >
                          <p className="text-xs text-[#78716C] mb-1">People (other transitions):</p>
                          <p className="text-xl font-bold text-[#1C1917]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                            {company.otherHopsCount}
                          </p>
                        </div>
                      </div>

                      <div
                        className={`grid grid-cols-1 gap-4 mb-4 pb-4 border-b border-[#E7E5E4] ${isTourTarget('recent') && index === 0 ? 'rounded-lg ring-4 ring-[#F59E0B]/45 p-2 -m-2' : ''}`}
                        data-tour={index === 0 ? 'recent' : undefined}
                      >
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
                      <div
                        className={`flex flex-wrap gap-2 ${isTourTarget('years-list') && index === 0 ? 'rounded-lg ring-4 ring-[#F59E0B]/45 p-2 -m-2' : ''}`}
                        data-tour={index === 0 ? 'years-list' : undefined}
                      >
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
            {(filteredCompaniesSecond ?? []).length > 0 && (
              <>
                <div ref={secondTransitionsRef} className="flex items-center justify-between mt-10 mb-6 bg-[#F3E8FF] px-6 py-4 rounded-lg">
                  <h2 className="text-lg font-semibold text-[#1C1917]">
                    2nd Transitions
                  </h2>
                  <span className="text-sm text-[#78716C]">
                    {(filteredCompaniesSecond ?? []).length} companies
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
                      whileHover={isSelectionMode ? undefined : { y: -4 }}
                      className={`relative overflow-hidden bg-white border ${(isOrgHighlighted(company.organizationId) || (appliedConnectionFilters && company.relatedCount > 0))
                        ? 'border-[#3B82F6] ring-2 ring-[#3B82F6]/100'
                        : 'border-[#E7E5E4]'
                        } rounded-xl p-6 hover:shadow-md transition-all ${isSelectionMode ? 'cursor-default' : 'cursor-pointer'} ${isCardSelected(2, company, index) ? 'shadow-[inset_0_0_0_2px_rgba(59,130,246,0.45)]' : ''}`}
                      onClick={() => {
                        if (isSelectionMode) return;
                        incrementActivationCounter('company_card_clicks', false);
                        incrementActivationCounter('company_cards_opened');
                        trackCoreFeatureUsed('company_card_opened', { hop: 2, company_name: company.name, dest_org_id: company.organizationId });
                        openCompanyDetailsInNewTab(company, 2);
                      }}
                    >
                      <div className={`absolute left-0 top-0 h-full ${isCardSelected(2, company, index) ? 'w-2 bg-[#3B82F6]' : 'w-px bg-[#E7E5E4]'}`} />
                      <div className="flex items-center gap-2 mb-3">
                        <div className="inline-flex items-center justify-center bg-[#A855F7] text-white text-sm font-bold rounded px-2 py-1">
                          #{company.rank}
                        </div>
                        {company.relatedCount > 0 && (
                          <div className="inline-flex items-center gap-1 bg-[#DCFCE7] text-[#15803D] text-xs font-semibold rounded-full px-2.5 py-1">
                            <span>👥</span>
                            <span>{company.relatedCount} connection{company.relatedCount !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCardSelected(2, company, index);
                          }}
                          className={`ml-auto w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${isCardSelected(2, company, index)
                            ? 'bg-[#3B82F6] border-[#3B82F6] ring-1 ring-[#93C5FD]'
                            : 'bg-white border-[#60A5FA] hover:border-[#3B82F6] ring-1 ring-[#DBEAFE]'
                            }`}
                          aria-label={isCardSelected(2, company, index) ? 'Unselect card' : 'Select card'}
                        >
                          {isCardSelected(2, company, index) && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
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
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSelectionMode) e.preventDefault();
                          }} // Prevent card click navigation
                          className={isSelectionMode ? 'pointer-events-none opacity-50 cursor-not-allowed' : ''}
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

                      <div className="grid grid-cols-1 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
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

            {/* 3+ Transitions Section */}
            {(filteredCompaniesThird ?? []).length > 0 && (
              <>
                <div ref={thirdTransitionsRef} className="flex items-center justify-between mt-10 mb-6 bg-[#D1FAE5] px-6 py-4 rounded-lg">
                  <h2 className="text-lg font-semibold text-[#1C1917]">
                    3+ Transitions
                  </h2>
                  <span className="text-sm text-[#78716C]">
                    {(filteredCompaniesThird ?? []).length} companies
                  </span>
                </div>

                <motion.div
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                >
                  {filteredCompaniesThird.map((company, index) => (
                    <motion.div
                      key={company.name ? `${company.name}-3rd-${index}` : `3rd-${index}`}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05, duration: 0.4 }}
                      whileHover={isSelectionMode ? undefined : { y: -4 }}
                      className={`relative overflow-hidden bg-white border ${(isOrgHighlighted(company.organizationId) || (appliedConnectionFilters && company.relatedCount > 0))
                        ? 'border-[#3B82F6] ring-2 ring-[#3B82F6]/100'
                        : 'border-[#E7E5E4]'
                        } rounded-xl p-6 hover:shadow-md transition-all ${isSelectionMode ? 'cursor-default' : 'cursor-pointer'} ${isCardSelected(3, company, index) ? 'shadow-[inset_0_0_0_2px_rgba(59,130,246,0.45)]' : ''}`}
                      onClick={() => {
                        if (isSelectionMode) return;
                        incrementActivationCounter('company_card_clicks', false);
                        incrementActivationCounter('company_cards_opened');
                        trackCoreFeatureUsed('company_card_opened', { hop: 3, company_name: company.name, dest_org_id: company.organizationId });
                        openCompanyDetailsInNewTab(company, 3);
                      }}
                    >
                      <div className={`absolute left-0 top-0 h-full ${isCardSelected(3, company, index) ? 'w-2 bg-[#3B82F6]' : 'w-px bg-[#E7E5E4]'}`} />
                      <div className="flex items-center gap-2 mb-3">
                        <div className="inline-flex items-center justify-center bg-[#059669] text-white text-sm font-bold rounded px-2 py-1">
                          #{company.rank}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCardSelected(3, company, index);
                          }}
                          className={`ml-auto w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${isCardSelected(3, company, index)
                            ? 'bg-[#3B82F6] border-[#3B82F6] ring-1 ring-[#93C5FD]'
                            : 'bg-white border-[#60A5FA] hover:border-[#3B82F6] ring-1 ring-[#DBEAFE]'
                            }`}
                          aria-label={isCardSelected(3, company, index) ? 'Unselect card' : 'Select card'}
                        >
                          {isCardSelected(3, company, index) && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                      </div>

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
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isSelectionMode) e.preventDefault();
                          }}
                          className={isSelectionMode ? 'pointer-events-none opacity-50 cursor-not-allowed' : ''}
                        >
                          <ExternalLink className="w-4 h-4 text-[#78716C] flex-shrink-0 cursor-pointer hover:text-[#3B82F6]" />
                        </a>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
                        <div>
                          <p className="text-xs text-[#78716C] mb-1">People (3+ transition):</p>
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

                      <div className="grid grid-cols-1 gap-4 mb-4 pb-4 border-b border-[#E7E5E4]">
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
                Alumni ({(filteredAlumni ?? []).length})
              </h2>
              <span className="text-sm text-[#78716C]">
                Showing currently {(filteredAlumni ?? []).length} alumni
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
                    className={`bg-white border rounded-xl p-6 hover:shadow-md transition-all shadow-sm ${(appliedConnectionFilters && person.is_match) ? 'border-[#3B82F6] ring-2 ring-[#3B82F6]/100' : 'border-[#E7E5E4]'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-bold text-[#1C1917]" style={{ fontFamily: "'Playfair Display', serif" }}>
                        {person.name}
                      </h3>
                      <a
                        href={buildLinkedInSearchUrl(person.name, getTopCompanyNamesForPerson(person))}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Search ${person.name} on LinkedIn`}
                        className="inline-flex items-center text-[#2563EB] hover:text-[#1D4ED8]"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    <p className="text-sm text-[#78716C] mb-4">
                      Exited {person.exited_year}
                    </p>

                    <div className="space-y-2">
                      {person.path && Array.isArray(person.path) && person.path.length > 0 ? (
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

            {(alumni ?? []).length === 0 && !loadingAlumni && (
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

      {activeTab === 'company-pathways' && !loading && !error && (
        <div className="hidden xl:flex fixed right-5 top-1/2 -translate-y-1/2 z-30">
          <div className="bg-white border border-[#E7E5E4] shadow-md rounded-xl p-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => scrollToTransitions(1)}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#DBEAFE] text-[#1E40AF] hover:bg-[#BFDBFE] transition-colors"
            >
              1st
            </button>
            {(filteredCompaniesSecond ?? []).length > 0 && (
              <button
                type="button"
                onClick={() => scrollToTransitions(2)}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#F3E8FF] text-[#6B21A8] hover:bg-[#E9D5FF] transition-colors"
              >
                2nd
              </button>
            )}
            {(filteredCompaniesThird ?? []).length > 0 && (
              <button
                type="button"
                onClick={() => scrollToTransitions(3)}
                className="px-3 py-2 text-xs font-semibold rounded-lg bg-[#D1FAE5] text-[#065F46] hover:bg-[#A7F3D0] transition-colors"
              >
                3+
              </button>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed inset-x-0 bottom-6 z-[100] px-6 flex justify-center pointer-events-none"
          >
            <div className="max-w-[1200px] w-full bg-[#1C1917]/95 backdrop-blur-md rounded-3xl border border-[#292524] shadow-2xl p-4 flex items-center gap-4 pointer-events-auto">
              <div className="w-12 h-12 rounded-2xl bg-[#3B82F6] text-white font-bold text-xl flex items-center justify-center shrink-0 shadow-lg shadow-[#3B82F6]/25">
                {selectedCount}
              </div>
              <div className="min-w-0 pr-4">
                <p className="text-[#FAFAF9] text-lg font-semibold truncate">{selectedSummaryText}</p>
                <p className="text-[#A8A29E] text-sm">selected for comparison</p>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <button
                  type="button"
                  onClick={clearSelectedCards}
                  className="h-11 px-6 rounded-2xl border border-[#44403C] text-[#FAFAF9] hover:bg-white/10 transition-all font-semibold text-sm"
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  onClick={() => setIsRoleModalOpen(true)}
                  className="h-11 px-7 rounded-2xl bg-[#3B82F6] text-white font-semibold hover:bg-[#2563EB] transition-all inline-flex items-center text-sm shadow-lg shadow-[#3B82F6]/20"
                >
                  Find `Jobs`
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Role Selection Modal */}
      <AnimatePresence>
        {isRoleModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-end justify-center p-0 bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="bg-white rounded-t-[40px] shadow-2xl w-full max-w-2xl overflow-hidden border-t border-[#E7E5E4]"
            >
              <div className="flex flex-col items-center pt-4 pb-2">
                <div className="w-12 h-1.5 bg-[#E7E5E4] rounded-full" />
              </div>
              <div className="p-8 pt-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                    <Search className="w-5 h-5 text-[#3B82F6]" />
                  </div>
                  <h2 className="text-2xl font-bold text-[#1C1917]" style={{ fontFamily: "'Playfair Display', serif" }}>
                    What role are you looking for?
                  </h2>
                </div>
                <p className="text-sm text-[#78716C] mb-8 line-clamp-2">
                  Searching at <span className="font-semibold text-[#1C1917]">{selectedCompanyNames.join(', ')}</span>
                </p>

                <div className="relative mb-6">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#A8A29E]" />
                  <input
                    autoFocus
                    type="text"
                    value={roleInput}
                    onChange={(e) => setRoleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && roleInput.trim()) {
                        if (!searchRoles.includes(roleInput.trim())) {
                          setSearchRoles([...searchRoles, roleInput.trim()]);
                        }
                        setRoleInput('');
                      }
                    }}
                    placeholder="Search or type a role..."
                    className="w-full pl-12 pr-4 h-14 bg-[#F9FAFB] border border-[#E7E5E4] rounded-2xl text-[#1C1917] placeholder-[#A8A29E] focus:outline-none focus:border-[#3B82F6] focus:ring-4 focus:ring-[#3B82F6]/5 transition-all"
                  />
                  {roleInput.trim() && (
                    <button
                      onClick={() => {
                        if (!searchRoles.includes(roleInput.trim())) {
                          setSearchRoles([...searchRoles, roleInput.trim()]);
                        }
                        setRoleInput('');
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-8 px-3 bg-[#1C1917] text-white text-xs font-bold rounded-lg hover:bg-black transition-all"
                    >
                      Add
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mb-8 min-h-[40px]">
                  {searchRoles.map((role) => (
                    <button
                      key={role}
                      onClick={() => setSearchRoles(searchRoles.filter(r => r !== role))}
                      className="group flex items-center gap-2 px-4 py-2 bg-[#F1F5F9] hover:bg-red-50 text-[#475569] hover:text-red-600 rounded-full text-sm font-medium border border-[#E2E8F0] hover:border-red-100 transition-all"
                    >
                      {role}
                      <X className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
                    </button>
                  ))}
                  {searchRoles.length === 0 && (
                    <p className="text-sm text-[#A8A29E] italic mt-2">No roles added yet. Press Enter to add tags.</p>
                  )}
                </div>

                <div className="flex flex-col gap-3 pb-8">
                  <button
                    disabled={searchRoles.length === 0}
                    onClick={() => openLinkedInJobsForSelection(searchRoles)}
                    className={`h-14 w-full rounded-2xl font-bold flex items-center justify-center transition-all ${searchRoles.length > 0
                      ? 'bg-[#1C1917] text-[#FAFAF9] hover:bg-black shadow-lg shadow-black/10'
                      : 'bg-[#F1F5F9] text-[#94A3B8] cursor-not-allowed'
                      }`}
                  >
                    {searchRoles.length > 0 ? `Find at ${selectedCount} Companies` : 'Select at least one role'}
                  </button>
                  <button
                    onClick={() => {
                      setIsRoleModalOpen(false);
                      setRoleInput('');
                    }}
                    className="h-12 w-full text-[#78716C] font-semibold hover:text-[#1C1917] transition-all text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;
