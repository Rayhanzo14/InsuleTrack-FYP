import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    signInWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import LeftPanel from '../components/LeftPanel';
import { MdEmail, MdLock } from 'react-icons/md';
import { logEvent } from '../utils/logEvent';

export default function Login() {
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.email || !form.password) {
            setError('Please enter your email and password.');
            return;
        }
        setLoading(true);
        try {
            // Step 1: Authenticate
            const { user } = await signInWithEmailAndPassword(auth, form.email, form.password);

            // Step 2: Read role from Firestore (role-based access control only — no email pattern check)
            let role = 'user';
            try {
                const snap = await getDoc(doc(db, 'users', user.uid));
                if (snap.exists()) {
                    role = snap.data().role || 'user';
                }
            } catch (firestoreErr) {
                // Firestore rules may not be set up yet — default to regular user
                console.warn('Could not read user role from Firestore:', firestoreErr.message);
            }

            // Step 2b: Update lastLogin timestamp so admin dashboard shows correct activity
            try {
                await setDoc(
                    doc(db, 'users', user.uid),
                    { lastLogin: serverTimestamp(), updatedAt: serverTimestamp() },
                    { merge: true }
                );
            } catch (tsErr) {
                console.warn('Could not update lastLogin:', tsErr.message);
            }

            // Log the successful login
            await logEvent(db, {
                level: 'INFO',
                category: 'User Login',
                user: form.email,
                message: 'User logged in successfully',
            });

            // Route based on Firestore role only
            if (role === 'admin') {
                navigate('/admin');
            } else {
                navigate('/dashboard');
            }
        } catch (err) {
            if (
                err.code === 'auth/user-not-found' ||
                err.code === 'auth/wrong-password' ||
                err.code === 'auth/invalid-credential'
            ) {
                setError('Invalid email or password. Please try again.');
                logEvent(db, { level: 'WARNING', category: 'Authentication', user: form.email, message: 'Failed login attempt — invalid password' });
            } else if (err.code === 'auth/invalid-email') {
                setError('Please enter a valid email address.');
            } else if (err.code === 'auth/too-many-requests') {
                setError('Too many failed attempts. Please try again later.');
                logEvent(db, { level: 'ERROR', category: 'Authentication', user: form.email, message: 'Account temporarily locked after multiple failed login attempts' });
            } else {
                setError('Login failed. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };


    return (
        <div className="auth-wrapper">
            <LeftPanel />

            <div className="right-panel">
                <div className="form-card">
                    <h2>Welcome Back</h2>
                    <p className="subtitle">Log in to continue your journey</p>

                    {error && (
                        <div className="error-msg">
                            <span>⚠️</span> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} noValidate>
                        {/* Email */}
                        <div className="form-group">
                            <label htmlFor="email">Email</label>
                            <div className="input-wrap">
                                <MdEmail className="input-icon" />
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    placeholder="your.email@example.com"
                                    value={form.email}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="form-group">
                            <label htmlFor="password">Password</label>
                            <div className="input-wrap">
                                <MdLock className="input-icon" />
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={form.password}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        {/* Forgot Password */}
                        <div className="forgot-row">
                            <Link to="/forgot-password" className="link-muted">
                                Forgot password?
                            </Link>
                        </div>

                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? <span className="spinner" /> : <>Log In &rarr;</>}
                        </button>
                    </form>

                    <p className="switch-link">
                        Don&apos;t have an account?{' '}
                        <Link to="/register">Create new account</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
