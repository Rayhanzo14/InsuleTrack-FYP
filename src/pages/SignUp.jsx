import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import LeftPanel from '../components/LeftPanel';
import { MdPerson, MdEmail, MdLock, MdCalendarToday } from 'react-icons/md';
import { logEvent } from '../utils/logEvent';

export default function SignUp() {
    const navigate = useNavigate();
    const [form, setForm] = useState({
        fullName: '',
        email: '',
        age: '',
        gender: '',
        password: '',
        confirmPassword: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
        setError('');
    };

    const validate = () => {
        if (!form.fullName.trim()) return 'Please enter your full name.';
        if (!form.email.trim()) return 'Please enter your email.';
        // Use explicit Number() conversion to avoid string-comparison edge cases
        const ageNum = Number(form.age);
        if (!form.age || isNaN(ageNum) || ageNum < 1 || ageNum > 120) return 'Please enter a valid age.';
        if (!form.gender) return 'Please select your gender.';
        if (form.password.length < 6) return 'Password must be at least 6 characters.';
        if (form.password !== form.confirmPassword) return 'Passwords do not match.';
        return null;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const errMsg = validate();
        if (errMsg) { setError(errMsg); return; }

        setLoading(true);
        try {
            // 1. Create the auth account
            const { user } = await createUserWithEmailAndPassword(auth, form.email, form.password);

            // 2. Save profile to Firestore BEFORE navigating — await so profile exists on first login
            await setDoc(doc(db, 'users', user.uid), {
                fullName: form.fullName,
                email: form.email,
                age: Number(form.age),
                gender: form.gender,
                role: 'user',
                createdAt: serverTimestamp(),
            });

            // 3. Log the registration
            logEvent(db, {
                level: 'INFO',
                category: 'User Registration',
                user: form.email,
                message: `New user account created: ${form.fullName}`,
            }).catch((logErr) => console.warn('Log failed (non-critical):', logErr.message));

            // 4. Navigate only after profile is confirmed saved
            setLoading(false);
            navigate('/login');

        } catch (err) {
            if (err.code === 'auth/email-already-in-use') {
                setError('An account with this email already exists.');
            } else if (err.code === 'auth/invalid-email') {
                setError('Please enter a valid email address.');
            } else {
                setError(err.message);
            }
            setLoading(false);
        }
    };

    return (
        <div className="auth-wrapper">
            <LeftPanel />

            <div className="right-panel">
                <div className="form-card">
                    <h2>Create Account</h2>
                    <p className="subtitle">Join us in preventing diabetes</p>

                    {error && (
                        <div className="error-msg">
                            <span>⚠️</span> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} noValidate>
                        {/* Full Name */}
                        <div className="form-group">
                            <label htmlFor="fullName">Full Name</label>
                            <div className="input-wrap">
                                <MdPerson className="input-icon" />
                                <input
                                    id="fullName"
                                    name="fullName"
                                    type="text"
                                    placeholder="John Doe"
                                    value={form.fullName}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

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

                        {/* Age + Gender row */}
                        <div className="row-2">
                            <div className="form-group">
                                <label htmlFor="age">Age</label>
                                <div className="input-wrap">
                                    <MdCalendarToday className="input-icon" />
                                    <input
                                        id="age"
                                        name="age"
                                        type="number"
                                        placeholder="25"
                                        min="1"
                                        max="120"
                                        value={form.age}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label htmlFor="gender">Gender</label>
                                <div className="input-wrap no-icon">
                                    <select
                                        id="gender"
                                        name="gender"
                                        value={form.gender}
                                        onChange={handleChange}
                                        required
                                    >
                                        <option value="">Select</option>
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                    </select>
                                </div>
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

                        {/* Confirm Password */}
                        <div className="form-group">
                            <label htmlFor="confirmPassword">Confirm Password</label>
                            <div className="input-wrap">
                                <MdLock className="input-icon" />
                                <input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    type="password"
                                    placeholder="••••••••"
                                    value={form.confirmPassword}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        </div>

                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? <span className="spinner" /> : <>Create Account &rarr;</>}
                        </button>
                    </form>

                    <p className="switch-link">
                        Already have an account?{' '}
                        <Link to="/login">Log in here</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
