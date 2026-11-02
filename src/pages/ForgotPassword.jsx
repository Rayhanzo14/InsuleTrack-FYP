/**
 * ForgotPassword.jsx
 *
 * 3-step flow:
 *   Step 1  →  Enter email        → sendPasswordResetEmail
 *   Step 2  →  Enter OOB code     → reveal Step 3
 *   Step 3  →  Enter new passwords → confirmPasswordReset
 *   Done    →  Show success, go to Login
 *
 * Firebase sends a link like:
 *   https://yourapp.com/__/auth/action?mode=resetPassword&oobCode=XXXX
 * The oobCode is the 6-char+ code the user pastes here.
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    sendPasswordResetEmail,
    confirmPasswordReset,
    verifyPasswordResetCode,
} from 'firebase/auth';
import { auth } from '../firebase';
import { MdEmail, MdLock, MdVpnKey } from 'react-icons/md';
import LeftPanel from '../components/LeftPanel';

/* ── Action URL for the reset email ── */
const ACTION_CODE_SETTINGS = {
    url: window.location.origin + '/forgot-password',
    handleCodeInApp: true,
};

/* ── local helper ── */
function PasswordStrength({ password }) {
    if (!password) return null;
    const score =
        (password.length >= 8 ? 1 : 0) +
        (/[A-Z]/.test(password) ? 1 : 0) +
        (/[0-9]/.test(password) ? 1 : 0) +
        (/[^A-Za-z0-9]/.test(password) ? 1 : 0);

    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', '#EF4444', '#F59E0B', '#3B82F6', '#10B981'];

    return (
        <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        style={{
                            flex: 1,
                            height: 4,
                            borderRadius: 999,
                            background: i <= score ? colors[score] : '#E5E7EB',
                            transition: 'background 0.3s',
                        }}
                    />
                ))}
            </div>
            <div style={{ fontSize: 11, color: colors[score], marginTop: 4, fontWeight: 600 }}>
                {labels[score]}
            </div>
        </div>
    );
}

export default function ForgotPassword() {
    const navigate = useNavigate();

    // step: 'email' | 'code' | 'password' | 'done'
    const [step, setStep] = useState('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [newPass, setNewPass] = useState('');
    const [confirmPass, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);
    const [resendSuccess, setResendSuccess] = useState(false);

    /* ── Auto-detect oobCode from email reset link ── */
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const oobCode = params.get('oobCode');
        if (oobCode) {
            setCode(oobCode);
            setLoading(true);
            verifyPasswordResetCode(auth, oobCode)
                .then(() => {
                    setStep('password');
                })
                .catch(() => {
                    setError('Invalid or expired reset link. Please request a new one.');
                    setStep('email');
                })
                .finally(() => setLoading(false));
        }
    }, []);

    /* ── Cooldown countdown ── */
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [resendCooldown]);

    /* ── Step 1: Send Reset Email ── */
    const handleSendEmail = async (e) => {
        e.preventDefault();
        if (!email.trim()) { setError('Please enter your email address.'); return; }
        setLoading(true); setError('');
        try {
            await sendPasswordResetEmail(auth, email.trim(), ACTION_CODE_SETTINGS);
            setStep('code');
            setResendCooldown(60); // 60-second cooldown before resend
        } catch (err) {
            if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
                setError('No account found with that email address.');
            } else if (err.code === 'auth/too-many-requests') {
                setError('Too many requests. Please wait a few minutes and try again.');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    /* ── Resend email from Step 2 ── */
    const handleResend = async () => {
        if (resendCooldown > 0 || loading) return;
        setLoading(true); setError(''); setResendSuccess(false);
        try {
            await sendPasswordResetEmail(auth, email.trim(), ACTION_CODE_SETTINGS);
            setResendCooldown(60);
            setResendSuccess(true);
        } catch (err) {
            if (err.code === 'auth/too-many-requests') {
                setError('Too many requests. Please wait a few minutes and try again.');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    /* ── Step 2: Verify Code ── */
    const handleVerifyCode = async (e) => {
        e.preventDefault();
        const trimmed = code.trim();
        if (!trimmed) { setError('Please enter the code from your email.'); return; }
        setLoading(true); setError('');
        try {
            // verifyPasswordResetCode confirms the oobCode is valid
            await verifyPasswordResetCode(auth, trimmed);
            setStep('password');
        } catch {
            setError('Invalid or expired code. Please request a new one.');
        } finally {
            setLoading(false);
        }
    };

    /* ── Step 3: Reset Password ── */
    const handleReset = async (e) => {
        e.preventDefault();
        if (newPass.length < 6) { setError('Password must be at least 6 characters.'); return; }
        if (newPass !== confirmPass) { setError('Passwords do not match.'); return; }
        setLoading(true); setError('');
        try {
            await confirmPasswordReset(auth, code.trim(), newPass);
            setStep('done');
        } catch (err) {
            if (err.code === 'auth/expired-action-code') {
                setError('The reset code has expired. Please request a new one.');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    /* ── UI ── */
    return (
        <div className="auth-wrapper">
            <LeftPanel />

            <div className="right-panel">
                <div className="form-card">

                    {/* ─── Step indicator ─────────────────── */}
                    {step !== 'done' && (
                        <div className="fp-steps">
                            {['email', 'code', 'password'].map((s, idx) => {
                                const order = { email: 0, code: 1, password: 2 };
                                const current = order[step];
                                const stepNum = idx + 1;
                                const done = current > idx;
                                const active = current === idx;
                                return (
                                    <React.Fragment key={s}>
                                        <div className={`fp-step-dot ${done ? 'done' : active ? 'active' : ''}`}>
                                            {done ? '✓' : stepNum}
                                        </div>
                                        {idx < 2 && <div className={`fp-step-line ${done ? 'done' : ''}`} />}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}

                    {/* ─── STEP 1: Email ──────────────────── */}
                    {step === 'email' && (
                        <>
                            <h2>Forgot Password?</h2>
                            <p className="subtitle">Enter your account email — we'll send you a reset code.</p>

                            {error && <div className="error-msg"><span>⚠️</span> {error}</div>}

                            <form onSubmit={handleSendEmail} noValidate>
                                <div className="form-group">
                                    <label htmlFor="fp-email">Email Address</label>
                                    <div className="input-wrap">
                                        <MdEmail className="input-icon" />
                                        <input
                                            id="fp-email"
                                            type="email"
                                            placeholder="your.email@example.com"
                                            value={email}
                                            onChange={(e) => { setEmail(e.target.value); setError(''); }}
                                            required
                                        />
                                    </div>
                                </div>

                                <button type="submit" className="btn-primary" disabled={loading}>
                                    {loading ? <span className="spinner" /> : '📧 Send Reset Code →'}
                                </button>
                            </form>
                        </>
                    )}

                    {/* ─── STEP 2: Code ───────────────────── */}
                    {step === 'code' && (
                        <>
                            <h2>Enter Reset Code</h2>
                            <p className="subtitle">
                                A reset link was sent to <strong>{email}</strong>. Open the email,
                                click <strong>"Reset Password"</strong>, then copy the long code
                                from the URL bar and paste it below.
                            </p>

                            <div className="fp-info-box">
                                💡 <strong>Can't find the email?</strong> Check your <strong>Spam / Junk</strong> folder.
                                The email is sent from <em>noreply@insuletrack-d7f62.firebaseapp.com</em>.
                                It may take up to 2 minutes to arrive.
                            </div>

                            {resendSuccess && (
                                <div className="success-msg">
                                    ✅ A new reset email has been sent!
                                </div>
                            )}

                            {error && <div className="error-msg"><span>⚠️</span> {error}</div>}

                            <form onSubmit={handleVerifyCode} noValidate>
                                <div className="form-group">
                                    <label htmlFor="fp-code">Reset Code</label>
                                    <div className="input-wrap">
                                        <MdVpnKey className="input-icon" />
                                        <input
                                            id="fp-code"
                                            type="text"
                                            placeholder="Paste the oobCode from the reset link"
                                            value={code}
                                            onChange={(e) => { setCode(e.target.value); setError(''); }}
                                            required
                                        />
                                    </div>
                                </div>

                                <button type="submit" className="btn-primary" disabled={loading}>
                                    {loading ? <span className="spinner" /> : '🔍 Verify Code →'}
                                </button>

                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}>
                                    <button
                                        type="button"
                                        className="link-muted"
                                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                                        onClick={() => { setStep('email'); setCode(''); setError(''); setResendSuccess(false); }}
                                    >
                                        ← Use a different email
                                    </button>
                                    <button
                                        type="button"
                                        className="link-muted"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
                                            opacity: resendCooldown > 0 ? 0.5 : 1,
                                        }}
                                        onClick={handleResend}
                                        disabled={resendCooldown > 0 || loading}
                                    >
                                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : '🔄 Resend email'}
                                    </button>
                                </div>
                            </form>
                        </>
                    )}

                    {/* ─── STEP 3: New Password ────────────── */}
                    {step === 'password' && (
                        <>
                            <h2>Set New Password</h2>
                            <p className="subtitle">Choose a strong new password for your account.</p>

                            {error && <div className="error-msg"><span>⚠️</span> {error}</div>}

                            <form onSubmit={handleReset} noValidate>
                                <div className="form-group">
                                    <label htmlFor="fp-newpass">New Password</label>
                                    <div className="input-wrap">
                                        <MdLock className="input-icon" />
                                        <input
                                            id="fp-newpass"
                                            type={showPass ? 'text' : 'password'}
                                            placeholder="Min. 6 characters"
                                            value={newPass}
                                            onChange={(e) => { setNewPass(e.target.value); setError(''); }}
                                            required
                                        />
                                        <button
                                            type="button"
                                            className="show-pass-btn"
                                            onClick={() => setShowPass((v) => !v)}
                                            title={showPass ? 'Hide password' : 'Show password'}
                                        >
                                            {showPass ? '🙈' : '👁️'}
                                        </button>
                                    </div>
                                    <PasswordStrength password={newPass} />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="fp-confirm">Confirm New Password</label>
                                    <div className="input-wrap">
                                        <MdLock className="input-icon" />
                                        <input
                                            id="fp-confirm"
                                            type={showPass ? 'text' : 'password'}
                                            placeholder="Re-enter your new password"
                                            value={confirmPass}
                                            onChange={(e) => { setConfirm(e.target.value); setError(''); }}
                                            required
                                        />
                                    </div>
                                    {confirmPass && newPass !== confirmPass && (
                                        <div style={{ fontSize: 11, color: '#EF4444', marginTop: 4 }}>
                                            ⚠️ Passwords don't match
                                        </div>
                                    )}
                                    {confirmPass && newPass === confirmPass && (
                                        <div style={{ fontSize: 11, color: '#10B981', marginTop: 4 }}>
                                            ✅ Passwords match
                                        </div>
                                    )}
                                </div>

                                <button type="submit" className="btn-primary" disabled={loading || newPass !== confirmPass}>
                                    {loading ? <span className="spinner" /> : '🔐 Reset Password →'}
                                </button>
                            </form>
                        </>
                    )}

                    {/* ─── DONE ───────────────────────────── */}
                    {step === 'done' && (
                        <div className="fp-done">
                            <div className="fp-done-icon">🎉</div>
                            <h2>Password Reset!</h2>
                            <p className="subtitle">
                                Your password has been changed successfully. You can now log in
                                with your new password.
                            </p>
                            <button
                                className="btn-primary"
                                onClick={() => navigate('/login')}
                            >
                                Go to Login →
                            </button>
                        </div>
                    )}

                    {/* ─── Back to Login ───────────────────── */}
                    {step !== 'done' && (
                        <p className="switch-link" style={{ marginTop: 16 }}>
                            Remember your password?{' '}
                            <Link to="/login">Log in</Link>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
