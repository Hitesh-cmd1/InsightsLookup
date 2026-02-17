import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, Plus, Info, TrendingUp, User as UserIcon, LogOut, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '../context/AuthContext';
import { getProfile, updateProfile, uploadResume, deleteResume, downloadResume } from '../api/insights';

const emptyExperience = () => ({
  company: '',
  role: '',
  start_date: '',
  end_date: ''
});

const emptyEducation = () => ({
  college: '',
  degree: '',
  start_date: '',
  end_date: ''
});

const ProfilePage = () => {
  const navigate = useNavigate();
  const { user, logout, openLogin, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [experiences, setExperiences] = useState([emptyExperience()]);
  const [educations, setEducations] = useState([emptyEducation()]);
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');
  const [resumeFileName, setResumeFileName] = useState(null);
  const [removingResume, setRemovingResume] = useState(false);

  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const hydrateFromProfile = (profile) => {
    if (!profile) return;
    setName(profile.name || '');
    setEmail(profile.email || user?.email || '');

    setExperiences(
      profile.work_experiences && profile.work_experiences.length
        ? profile.work_experiences.map((exp) => ({
            company: exp.company || '',
            role: exp.role || '',
            start_date: exp.start_date || '',
            end_date: exp.end_date || ''
          }))
        : [emptyExperience()]
    );

    setEducations(
      profile.educations && profile.educations.length
        ? profile.educations.map((edu) => ({
            college: edu.college || '',
            degree: edu.degree || '',
            start_date: edu.start_date || '',
            end_date: edu.end_date || ''
          }))
        : [emptyEducation()]
    );

    setSkills(Array.isArray(profile.skills) ? profile.skills : []);
    setResumeFileName(profile.profile_id || null);
  };

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      openLogin();
      navigate('/');
      return;
    }

    setLoading(true);
    getProfile()
      .then((data) => {
        hydrateFromProfile(data);
      })
      .catch((err) => {
        console.error('Failed to load profile', err);
        setEmail(user.email);
        setName(user.name || user.email?.split('@')[0] || '');
      })
      .finally(() => setLoading(false));
  }, [authLoading, user, openLogin, navigate]);

  const handleAddSkill = () => {
    const value = (skillInput || '').trim();
    if (!value) return;
    if (skills.includes(value)) {
      setSkillInput('');
      return;
    }
    if (skills.length >= 10) {
      toast.error('You can add up to 10 skills');
      return;
    }
    setSkills([...skills, value]);
    setSkillInput('');
  };

  const handleSkillKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSkill();
    } else if (e.key === 'Backspace' && !skillInput && skills.length) {
      e.preventDefault();
      setSkills(skills.slice(0, -1));
    }
  };

  const handleRemoveSkill = (skill) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  const handleExperienceChange = (index, field, value) => {
    setExperiences((prev) =>
      prev.map((exp, i) => (i === index ? { ...exp, [field]: value } : exp))
    );
  };

  const handleEducationChange = (index, field, value) => {
    setEducations((prev) =>
      prev.map((edu, i) => (i === index ? { ...edu, [field]: value } : edu))
    );
  };

  const handleAddExperience = () => {
    setExperiences([...experiences, emptyExperience()]);
  };

  const handleRemoveExperience = (index) => {
    if (experiences.length === 1) return;
    setExperiences(experiences.filter((_, i) => i !== index));
  };

  const handleAddEducation = () => {
    setEducations([...educations, emptyEducation()]);
  };

  const handleRemoveEducation = (index) => {
    if (educations.length === 1) return;
    setEducations(educations.filter((_, i) => i !== index));
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!user) {
      openLogin();
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name || user.name || '',
        work_experiences: experiences.filter(
          (exp) => exp.company || exp.role || exp.start_date || exp.end_date
        ),
        educations: educations.filter(
          (edu) => edu.college || edu.degree || edu.start_date || edu.end_date
        ),
        skills
      };
      const updated = await updateProfile(payload);
      hydrateFromProfile(updated);
      toast.success('Profile saved');
    } catch (err) {
      console.error('Failed to save profile', err);
      toast.error(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleResumeUpload = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Please upload a PDF resume');
      return;
    }

    setUploading(true);
    try {
      const updated = await uploadResume(file);
      hydrateFromProfile(updated);
      toast.success('Resume uploaded and profile auto-filled');
    } catch (err) {
      console.error('Failed to upload resume', err);
      toast.error(err.message || 'Failed to upload resume');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleRemoveResume = async () => {
    if (!resumeFileName) return;
    setRemovingResume(true);
    try {
      const updated = await deleteResume();
      hydrateFromProfile(updated);
      setResumeFileName(null);
      toast.success('Resume removed');
    } catch (err) {
      console.error('Failed to remove resume', err);
      toast.error(err.message || 'Failed to remove resume');
    } finally {
      setRemovingResume(false);
    }
  };

  const handleDownloadResume = () => {
    if (!resumeFileName) return;
    downloadResume(resumeFileName).catch((err) => {
      console.error('Failed to download resume', err);
      toast.error(err.message || 'Failed to download resume');
    });
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF9] flex items-center justify-center">
        <div className="flex items-center gap-3 text-[#3B82F6]">
          <svg
            className="animate-spin h-6 w-6 text-[#3B82F6]"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <span className="text-sm font-medium">Loading profile...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF9]">
      {/* Header */}
      <header className="bg-white border-b border-[#E7E5E4]">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
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

          <div className="relative">
            {user ? (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                  className="w-10 h-10 bg-[#1C1917]/5 hover:bg-[#1C1917]/10 rounded-full flex items-center justify-center transition-all"
                >
                  <UserIcon className="w-5 h-5 text-[#1C1917]" />
                </button>
                {isProfileMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-[#E7E5E4] rounded-xl shadow-lg p-2 z-40">
                    <div className="px-3 py-2 border-b border-[#E7E5E4] mb-1">
                      <p className="text-xs text-[#78716C]">Signed in as</p>
                      <p className="text-sm font-semibold text-[#1C1917] truncate">
                        {user.name}
                      </p>
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
                  </div>
                )}
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
      </header>

      {/* Main Content */}
      <main className="max-w-[900px] mx-auto px-6 py-10">
        {/* Top: Resume Upload */}
        <section className="bg-white border border-[#E7E5E4] rounded-2xl p-6 sm:p-8 mb-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1
                className="text-2xl sm:text-3xl font-bold text-[#1C1917] mb-1"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Your Profile
              </h1>
              <p className="text-sm text-[#78716C]">
                Upload your latest resume to auto-fill your experience and education.
              </p>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-2">
              {resumeFileName ? (
                <div className="flex items-center gap-3 px-4 py-2 rounded-xl border border-[#E7E5E4] bg-[#FAFAF9]">
                  <button
                    type="button"
                    onClick={handleDownloadResume}
                    className="inline-flex items-center gap-2 text-sm font-medium text-[#1C1917] hover:text-[#3B82F6] transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    <span className="truncate max-w-[200px]">{resumeFileName}</span>
                    <Download className="w-4 h-4 flex-shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveResume}
                    disabled={removingResume}
                    className="p-1 text-[#78716C] hover:text-[#EF4444] hover:bg-[#EF4444]/5 rounded transition-colors disabled:opacity-50"
                    title="Remove resume"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <label className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1C1917] text-[#FAFAF9] text-sm font-semibold cursor-pointer hover:bg-[#292524] transition-all">
                    <Upload className="w-4 h-4" />
                    <span>{uploading ? 'Uploading...' : 'Upload Resume (PDF)'}</span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={handleResumeUpload}
                      disabled={uploading}
                    />
                  </label>
                  <div className="flex items-start gap-2 text-xs text-[#78716C] max-w-xs">
                    <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>Parsing works best with resumes exported from LinkedIn.</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Profile Form */}
        <form
          onSubmit={handleSave}
          className="space-y-8"
        >
          {/* Basic Information */}
          <section className="bg-white border border-[#E7E5E4] rounded-2xl p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-[#1C1917] mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1C1917]">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full h-11 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#1C1917]">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  readOnly
                  className="w-full h-11 px-3 rounded-lg border border-[#E7E5E4] bg-[#F5F5F4] text-sm text-[#78716C] cursor-not-allowed"
                />
                <p className="text-xs text-[#78716C]">
                  You can&apos;t change your email after login.
                </p>
              </div>
            </div>
          </section>

          {/* Work Experience */}
          <section className="bg-white border border-[#E7E5E4] rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1C1917]">Work Experience</h2>
              <button
                type="button"
                onClick={handleAddExperience}
                className="inline-flex items-center gap-1 text-sm text-[#3B82F6] hover:underline"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>

            <div className="space-y-6">
              {experiences.map((exp, index) => (
                <div
                  key={index}
                  className="border border-[#E7E5E4] rounded-xl p-4 sm:p-5 bg-[#F9FAFB]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[#44403C]">
                      Experience {index + 1}
                    </p>
                    {experiences.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveExperience(index)}
                        className="inline-flex items-center gap-1 text-xs text-[#78716C] hover:text-[#EF4444]"
                      >
                        <X className="w-3 h-3" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        Company Name
                      </label>
                      <input
                        type="text"
                        value={exp.company}
                        onChange={(e) =>
                          handleExperienceChange(index, 'company', e.target.value)
                        }
                        placeholder="e.g. Google"
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        Role / Title
                      </label>
                      <input
                        type="text"
                        value={exp.role}
                        onChange={(e) =>
                          handleExperienceChange(index, 'role', e.target.value)
                        }
                        placeholder="e.g. Product Manager"
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={exp.start_date || ''}
                        onChange={(e) =>
                          handleExperienceChange(index, 'start_date', e.target.value)
                        }
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={exp.end_date || ''}
                        onChange={(e) =>
                          handleExperienceChange(index, 'end_date', e.target.value)
                        }
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Education */}
          <section className="bg-white border border-[#E7E5E4] rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1C1917]">Education</h2>
              <button
                type="button"
                onClick={handleAddEducation}
                className="inline-flex items-center gap-1 text-sm text-[#3B82F6] hover:underline"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>

            <div className="space-y-6">
              {educations.map((edu, index) => (
                <div
                  key={index}
                  className="border border-[#E7E5E4] rounded-xl p-4 sm:p-5 bg-[#F9FAFB]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-[#44403C]">
                      Education {index + 1}
                    </p>
                    {educations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveEducation(index)}
                        className="inline-flex items-center gap-1 text-xs text-[#78716C] hover:text-[#EF4444]"
                      >
                        <X className="w-3 h-3" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        College Name
                      </label>
                      <input
                        type="text"
                        value={edu.college}
                        onChange={(e) =>
                          handleEducationChange(index, 'college', e.target.value)
                        }
                        placeholder="e.g. Stanford University"
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        Department / Degree
                      </label>
                      <input
                        type="text"
                        value={edu.degree}
                        onChange={(e) =>
                          handleEducationChange(index, 'degree', e.target.value)
                        }
                        placeholder="e.g. B.S. Computer Science"
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={edu.start_date || ''}
                        onChange={(e) =>
                          handleEducationChange(index, 'start_date', e.target.value)
                        }
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-[#1C1917]">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={edu.end_date || ''}
                        onChange={(e) =>
                          handleEducationChange(index, 'end_date', e.target.value)
                        }
                        className="w-full h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Skills */}
          <section className="bg-white border border-[#E7E5E4] rounded-2xl p-6 sm:p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-[#1C1917] mb-4">Skills</h2>
            <p className="text-xs text-[#78716C] mb-3">
              Add skills individually as tags. Press Enter to add. You can add up to 10 skills.
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#F3F4F6] text-xs font-medium text-[#111827]"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="ml-1 text-[#6B7280] hover:text-[#EF4444]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {skills.length === 0 && (
                <span className="text-xs text-[#9CA3AF]">
                  No skills added yet. Start typing to add one.
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown}
                placeholder="Type a skill and press Enter"
                className="flex-1 h-10 px-3 rounded-lg border border-[#E7E5E4] bg-white text-sm text-[#1C1917] focus:outline-none focus:border-[#1C1917] focus:ring-0"
              />
              <button
                type="button"
                onClick={handleAddSkill}
                className="px-3 py-2 rounded-lg border border-[#E7E5E4] text-xs font-medium text-[#1C1917] hover:bg-[#F5F5F4]"
              >
                Add
              </button>
            </div>
          </section>

          {/* Actions */}
          <div className="flex justify-end pt-2 pb-10">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-[#1C1917] text-sm font-semibold text-[#FAFAF9] hover:bg-[#292524] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default ProfilePage;

