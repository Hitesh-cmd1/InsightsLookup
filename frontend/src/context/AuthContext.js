import React, { createContext, useContext, useState, useEffect } from 'react';
import { logoutUser } from '../api/insights';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [authModalCallback, setAuthModalCallback] = useState(null);

    useEffect(() => {
        // Load user from localStorage on init
        const savedUser = localStorage.getItem('insights_user');
        if (savedUser) {
            try {
                setUser(JSON.parse(savedUser));
            } catch (e) {
                console.error('Failed to parse user', e);
            }
        }
        setLoading(false);
    }, []);

    const login = (userData) => {
        setUser(userData);
        localStorage.setItem('insights_user', JSON.stringify(userData));
    };

    const logout = async () => {
        try {
            await logoutUser();
        } catch (err) {
            console.error('Failed to logout on server', err);
        }
        setUser(null);
        localStorage.removeItem('insights_user');
    };

    const openLogin = (callback = null) => {
        setAuthModalCallback(() => callback);
        setIsAuthModalOpen(true);
    };

    const closeLogin = () => {
        setIsAuthModalOpen(false);
        setAuthModalCallback(null);
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            login,
            logout,
            isAuthModalOpen,
            openLogin,
            closeLogin,
            authModalCallback
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
