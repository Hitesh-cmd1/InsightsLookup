import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Mail, ShieldCheck, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { requestOTP, verifyOTP } from '../api/insights';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const AuthModal = ({ isOpen, onClose, onSuccess }) => {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [step, setStep] = useState('email'); // 'email' or 'otp'
    const [loading, setLoading] = useState(false);
    const [resendTimer, setResendTimer] = useState(0);
    const [resendCount, setResendCount] = useState(0);

    useEffect(() => {
        let timer;
        if (resendTimer > 0) {
            timer = setInterval(() => {
                setResendTimer((prev) => prev - 1);
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [resendTimer]);

    // Reset state when modal opens/closes
    useEffect(() => {
        if (!isOpen) {
            setEmail('');
            setOtp('');
            setStep('email');
            setLoading(false);
            setResendTimer(0);
            setResendCount(0);
        }
    }, [isOpen]);

    const handleRequestOTP = async (e) => {
        if (e) e.preventDefault();
        if (!email) return toast.error('Please enter your email');

        setLoading(true);
        try {
            await requestOTP(email);
            setStep('otp');
            setResendTimer(60);
            toast.success('OTP sent to your email');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResendOTP = async () => {
        if (resendTimer > 0) return;
        if (resendCount >= 5) return toast.error('Maximum resend attempts reached');

        setLoading(true);
        try {
            await requestOTP(email);
            setResendTimer(60);
            setResendCount((prev) => prev + 1);
            toast.success('OTP resent successfully');
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOTP = async (e) => {
        e.preventDefault();
        if (!otp) return toast.error('Please enter the OTP');

        setLoading(true);
        try {
            const data = await verifyOTP(email, otp);
            login(data.user);
            toast.success('Logged in successfully');
            onSuccess?.();
            onClose();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                    className="absolute inset-0 bg-black/40 backdrop-blur-md"
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-md overflow-hidden bg-white/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20"
                >
                    {/* Background Highlight */}
                    <div
                        className="absolute inset-0 opacity-[0.05] bg-cover bg-center -z-10 pointer-events-none"
                        style={{
                            backgroundImage: 'url(https://images.unsplash.com/photo-1605764948243-24558b81a2c7?crop=entropy&cs=srgb&fm=jpg&q=85)',
                        }}
                    />

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute right-6 top-6 p-2 text-[#78716C] hover:text-[#1C1917] hover:bg-[#F5F5F4] rounded-full transition-all"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    <div className="p-8 sm:p-10 pt-12 sm:pt-14">
                        <div className="mb-8 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#3B82F6]/10 text-[#3B82F6] mb-6">
                                {step === 'email' ? <Mail className="w-8 h-8" /> : <ShieldCheck className="w-8 h-8" />}
                            </div>
                            <h2 className="text-3xl font-bold text-[#1C1917] mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                                {step === 'email' ? 'Welcome Back' : 'Security Check'}
                            </h2>
                            <p className="text-[#78716C]">
                                {step === 'email'
                                    ? 'Enter your email to sign in or create an account'
                                    : `We sent a code to ${email}`}
                            </p>
                        </div>

                        <AnimatePresence mode="wait">
                            {step === 'email' ? (
                                <motion.form
                                    key="email-step"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    onSubmit={handleRequestOTP}
                                    className="space-y-6"
                                >
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-[#1C1917]">Email Address</label>
                                        <div className="relative">
                                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#78716C]" />
                                            <input
                                                type="email"
                                                required
                                                placeholder="name@example.com"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full h-14 pl-12 pr-4 bg-white/50 border border-[#E7E5E4] rounded-2xl focus:outline-none focus:border-[#1C1917] transition-all"
                                                data-testid="email-input"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="w-full h-14 bg-[#1C1917] text-white rounded-full font-semibold flex items-center justify-center gap-2 hover:bg-[#292524] transition-all disabled:opacity-70"
                                        data-testid="request-otp-button"
                                    >
                                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Request OTP <ArrowRight className="w-4 h-4" /></>}
                                    </button>
                                </motion.form>
                            ) : (
                                <motion.form
                                    key="otp-step"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    onSubmit={handleVerifyOTP}
                                    className="space-y-6"
                                >
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-[#1C1917]">Verification Code</label>
                                        <div className="relative">
                                            <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#78716C]" />
                                            <input
                                                type="text"
                                                required
                                                maxLength={6}
                                                placeholder="000000"
                                                value={otp}
                                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                                className="w-full h-14 pl-12 pr-4 bg-white/50 border border-[#E7E5E4] rounded-2xl text-2xl tracking-[0.5em] font-mono focus:outline-none focus:border-[#1C1917] transition-all"
                                                data-testid="otp-input"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="w-full h-14 bg-[#1C1917] text-white rounded-full font-semibold flex items-center justify-center gap-2 hover:bg-[#292524] transition-all disabled:opacity-70"
                                        data-testid="verify-otp-button"
                                    >
                                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Sign In'}
                                    </button>
                                    <div className="flex flex-col items-center gap-2 pt-2">
                                        <button
                                            type="button"
                                            disabled={resendTimer > 0 || loading || resendCount >= 5}
                                            onClick={handleResendOTP}
                                            className="text-sm text-[#3B82F6] hover:underline flex items-center gap-2 disabled:opacity-50 disabled:no-underline"
                                        >
                                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                            {resendTimer > 0 ? `Resend Code in ${resendTimer}s` : 'Resend Code'}
                                        </button>
                                        {resendCount > 0 && resendCount < 5 && (
                                            <span className="text-xs text-[#78716C]">{resendCount}/5 attempts used</span>
                                        )}
                                        {resendCount >= 5 && (
                                            <span className="text-xs text-[#EF4444]">Maximum resend limit reached</span>
                                        )}
                                    </div>
                                </motion.form>
                            )}
                        </AnimatePresence>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default AuthModal;
