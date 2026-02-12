import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, TrendingUp, Users, Briefcase, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { searchOrganizations } from '../api/insights';

const SUGGESTION_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 1;

const LandingPage = () => {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const suggestionRef = useRef(null);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 50 }, (_, i) => currentYear - i);

  // Debounced organisation suggestions as user types
  useEffect(() => {
    const q = (companyName || '').trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSuggestionsError(null);
      setLoadingSuggestions(false);
      return;
    }
    const t = setTimeout(() => {
      setLoadingSuggestions(true);
      setSuggestionsError(null);
      searchOrganizations(q)
        .then((list) => {
          setSuggestions(Array.isArray(list) ? list : []);
          setSuggestionsError(null);
        })
        .catch((err) => {
          setSuggestions([]);
          setSuggestionsError(err.message || 'Could not load suggestions');
        })
        .finally(() => setLoadingSuggestions(false));
    }, SUGGESTION_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [companyName]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const onDocClick = (e) => {
      if (suggestionRef.current && !suggestionRef.current.contains(e.target)) {
        setSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleCompanyChange = (e) => {
    const v = e.target.value;
    setCompanyName(v);
    setSelectedOrg(null);
    if (v.trim().length >= MIN_QUERY_LENGTH) setSuggestionsOpen(true);
    else setSuggestionsOpen(false);
  };

  const handleSelectOrg = (org) => {
    setSelectedOrg(org);
    setCompanyName(org.name);
    setSuggestionsOpen(false);
    setSuggestions([]);
    setSuggestionsError(null);
  };

  const handleSearch = async (e) => {
    e.preventDefault();

    if (!companyName.trim()) {
      toast.error('Please enter a company name');
      return;
    }

    if (!startYear || !endYear) {
      toast.error('Please select both start and end years');
      return;
    }

    if (parseInt(startYear) > parseInt(endYear)) {
      toast.error('Start year cannot be after end year');
      return;
    }

    setSearching(true);
    try {
      let resolved = selectedOrg;
      if (!resolved) {
        const orgs = await searchOrganizations(companyName);
        if (!orgs || orgs.length === 0) {
          toast.error(`No organizations found for "${companyName}"`);
          setSearching(false);
          return;
        }
        resolved = orgs[0];
      }
      const state = {
        orgId: resolved.id,
        companyName: resolved.name,
        startYear,
        endYear
      };
      try {
        sessionStorage.setItem('insightsDashboardState', JSON.stringify(state));
      } catch (_) {}
      toast.success(`Loading alumni data for ${resolved.name} (${startYear}-${endYear})`);
      navigate('/dashboard', { state });
    } catch (err) {
      toast.error(err.message || 'Failed to search organizations');
    } finally {
      setSearching(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.15,
        delayChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.6,
        ease: [0.22, 1, 0.36, 1]
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background texture */}
        <div 
          className="absolute inset-0 opacity-[0.15] bg-cover bg-center"
          style={{
            backgroundImage: 'url(https://images.unsplash.com/photo-1605764948243-24558b81a2c7?crop=entropy&cs=srgb&fm=jpg&q=85)',
            filter: 'brightness(1.2)'
          }}
        />
        
        <div className="relative max-w-[1400px] mx-auto px-6 sm:px-12 py-24 sm:py-32">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="flex flex-col items-center text-center space-y-12"
          >
            {/* Heading */}
            <motion.div variants={itemVariants} className="space-y-6 max-w-4xl">
              <h1 
                className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-[#1C1917]"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Track Your Network's
                <br />
                <span className="text-[#F59E0B]">Career Journey</span>
              </h1>
              <p className="text-base sm:text-lg text-[#78716C] max-w-2xl mx-auto leading-relaxed">
                Discover where your alumni network is heading. Uncover career transitions, 
                identify hiring patterns, and connect with former colleagues navigating similar paths.
              </p>
            </motion.div>

            {/* Search Form with Glassmorphism */}
            <motion.div 
              variants={itemVariants}
              className="w-full max-w-3xl"
            >
              <form 
                onSubmit={handleSearch}
                className="bg-white/70 backdrop-blur-xl border border-white/40 rounded-3xl p-8 sm:p-12"
                style={{ boxShadow: '0 8px 30px rgb(0,0,0,0.04)' }}
                data-testid="alumni-search-form"
              >
                <div className="space-y-6">
                  {/* Company Name Input with suggestions */}
                  <div className="space-y-2" ref={suggestionRef}>
                    <label 
                      htmlFor="company-name" 
                      className="block text-sm font-medium text-[#1C1917] text-left"
                    >
                      Company Name
                    </label>
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#78716C] z-10" />
                      <input
                        id="company-name"
                        type="text"
                        placeholder="Type to search organizations..."
                        value={companyName}
                        onChange={handleCompanyChange}
                        onFocus={() => companyName.trim().length >= MIN_QUERY_LENGTH && setSuggestionsOpen(true)}
                        className="w-full h-14 pl-12 pr-4 bg-white/50 border border-[#E7E5E4] rounded-lg text-lg text-[#1C1917] placeholder:text-[#78716C] focus:outline-none focus:border-[#1C1917] focus:ring-0 transition-colors"
                        data-testid="company-name-input"
                        autoComplete="off"
                      />
                      {suggestionsOpen && (suggestions.length > 0 || loadingSuggestions || suggestionsError) && (
                        <div
                          className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#E7E5E4] rounded-lg shadow-lg max-h-60 overflow-auto z-20"
                          data-testid="company-suggestions"
                        >
                          {loadingSuggestions && (
                            <div className="flex items-center gap-2 px-4 py-3 text-[#78716C] text-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading...
                            </div>
                          )}
                          {!loadingSuggestions && suggestionsError && (
                            <div className="px-4 py-3 text-amber-700 text-sm bg-amber-50">
                              {suggestionsError}
                            </div>
                          )}
                          {!loadingSuggestions && !suggestionsError && suggestions.length === 0 && companyName.trim().length >= MIN_QUERY_LENGTH && (
                            <div className="px-4 py-3 text-[#78716C] text-sm">
                              No organizations found. Try a different name.
                            </div>
                          )}
                          {!loadingSuggestions && suggestions.map((org) => (
                            <button
                              key={org.id}
                              type="button"
                              onClick={() => handleSelectOrg(org)}
                              className="w-full text-left px-4 py-3 hover:bg-[#F5F5F4] text-[#1C1917] border-b border-[#E7E5E4] last:border-b-0 first:rounded-t-lg last:rounded-b-lg transition-colors"
                              data-testid={`suggestion-${org.id}`}
                            >
                              {org.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Year Range */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    {/* Start Year */}
                    <div className="space-y-2">
                      <label 
                        htmlFor="start-year" 
                        className="block text-sm font-medium text-[#1C1917] text-left"
                      >
                        From Year
                      </label>
                      <select
                        id="start-year"
                        value={startYear}
                        onChange={(e) => setStartYear(e.target.value)}
                        className="w-full h-14 px-4 bg-white/50 border border-[#E7E5E4] rounded-lg text-lg text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0 transition-colors cursor-pointer"
                        data-testid="start-year-select"
                      >
                        <option value="">Select year</option>
                        {years.map(year => (
                          <option key={`start-${year}`} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>

                    {/* End Year */}
                    <div className="space-y-2">
                      <label 
                        htmlFor="end-year" 
                        className="block text-sm font-medium text-[#1C1917] text-left"
                      >
                        To Year
                      </label>
                      <select
                        id="end-year"
                        value={endYear}
                        onChange={(e) => setEndYear(e.target.value)}
                        className="w-full h-14 px-4 bg-white/50 border border-[#E7E5E4] rounded-lg text-lg text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0 transition-colors cursor-pointer"
                        data-testid="end-year-select"
                      >
                        <option value="">Select year</option>
                        {years.map(year => (
                          <option key={`end-${year}`} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={searching}
                    className="w-full h-14 bg-[#1C1917] text-[#FAFAF9] rounded-full text-lg font-semibold hover:bg-[#292524] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                    data-testid="search-alumni-button"
                  >
                    {searching ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        Track Alumni Network
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Value Proposition - Bento Grid */}
      <div className="max-w-[1400px] mx-auto px-6 sm:px-12 py-24">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Card 1 - Alumni Transitions */}
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-white border border-[#E7E5E4] rounded-2xl p-8 hover:shadow-md transition-all"
              style={{ boxShadow: '0 2px 8px rgb(0,0,0,0.02)' }}
              data-testid="feature-card-transitions"
            >
              <div className="w-12 h-12 bg-[#F59E0B]/10 rounded-xl flex items-center justify-center mb-6">
                <TrendingUp className="w-6 h-6 text-[#F59E0B]" />
              </div>
              <h3 
                className="text-2xl font-bold text-[#1C1917] mb-4"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Career Transitions
              </h3>
              <p className="text-[#78716C] leading-relaxed">
                Visualize where your alumni are moving. Identify trending companies, 
                roles, and industries in your network.
              </p>
            </motion.div>

            {/* Card 2 - Job Opportunities */}
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-white border border-[#E7E5E4] rounded-2xl p-8 hover:shadow-md transition-all"
              style={{ boxShadow: '0 2px 8px rgb(0,0,0,0.02)' }}
              data-testid="feature-card-opportunities"
            >
              <div className="w-12 h-12 bg-[#10B981]/10 rounded-xl flex items-center justify-center mb-6">
                <Briefcase className="w-6 h-6 text-[#10B981]" />
              </div>
              <h3 
                className="text-2xl font-bold text-[#1C1917] mb-4"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Opportunity Insights
              </h3>
              <p className="text-[#78716C] leading-relaxed">
                Discover which companies are actively hiring from your network. 
                Optimize your job search with data-driven recommendations.
              </p>
            </motion.div>

            {/* Card 3 - Network Connections */}
            <motion.div
              whileHover={{ y: -4 }}
              className="bg-white border border-[#E7E5E4] rounded-2xl p-8 hover:shadow-md transition-all md:col-span-2 lg:col-span-1"
              style={{ boxShadow: '0 2px 8px rgb(0,0,0,0.02)' }}
              data-testid="feature-card-network"
            >
              <div className="w-12 h-12 bg-[#3B82F6]/10 rounded-xl flex items-center justify-center mb-6">
                <Users className="w-6 h-6 text-[#3B82F6]" />
              </div>
              <h3 
                className="text-2xl font-bold text-[#1C1917] mb-4"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Network Intelligence
              </h3>
              <p className="text-[#78716C] leading-relaxed">
                Find colleagues who've made similar career moves. Get introductions, 
                advice, and insider perspectives from your extended network.
              </p>
            </motion.div>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#E7E5E4] py-12">
        <div className="max-w-[1400px] mx-auto px-6 sm:px-12">
          <p className="text-center text-sm text-[#78716C]">
            © {currentYear} Alumni Network Tracker. Empowering professional growth through network insights.
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;