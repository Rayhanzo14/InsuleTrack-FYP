import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { logEvent } from '../utils/logEvent';
import logo from '../assets/logo.png';
import useNotifications from '../hooks/useNotifications';
import {
    MdDashboard,
    MdEditNote,
    MdTrendingUp,
    MdEmojiEvents,
    MdLightbulb,
    MdBarChart,
    MdPerson,
} from 'react-icons/md';

const navItems = [
    { to: '/dashboard', icon: <MdDashboard />, label: 'Dashboard' },
    { to: '/record', icon: <MdEditNote />, label: 'Record data' },
    { to: '/progress', icon: <MdTrendingUp />, label: 'Progress' },
    { to: '/achievements', icon: <MdEmojiEvents />, label: 'Achievements' },
    { to: '/recommendations', icon: <MdLightbulb />, label: 'Recommendations' },
    { to: '/report', icon: <MdBarChart />, label: 'Report' },
    { to: '/profile', icon: <MdPerson />, label: 'Profile' },
];

export default function Sidebar() {
    const navigate = useNavigate();
    const [showConfirm, setShowConfirm] = useState(false);
    const [reminders, setReminders] = useState({
        dailyRecord: true, weeklyProgress: true, medication: false, activity: true,
    });
    const [timePreference, setTimePreference] = useState('morning');
    const [customTime, setCustomTime] = useState('09:00');

    // Load user's reminder settings from Firestore
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) return;
            try {
                const snap = await getDoc(doc(db, 'users', u.uid));
                if (snap.exists()) {
                    const d = snap.data();
                    if (d.reminders) setReminders(d.reminders);
                    if (d.timePreference) setTimePreference(d.timePreference);
                    // Load saved custom time so notifications fire at the right time
                    if (d.customTime) setCustomTime(d.customTime);
                }
            } catch { /* use defaults */ }
        });
        return () => unsub();
    }, []);

    // Activate notification scheduling globally while user is logged in.
    // Pass customTime so the user's saved preference is respected.
    useNotifications(reminders, timePreference, true, customTime);

    const handleLogout = async () => {
        const currentUser = auth.currentUser;
        if (currentUser) {
            await logEvent(db, {
                level: 'INFO',
                category: 'User Logout',
                user: currentUser.email,
                message: 'User session ended',
            });
        }
        await signOut(auth);
        navigate('/login');
    };


    // Only show 5 key items in the mobile bottom nav (space-constrained)
    const mobileNavItems = [
        { to: '/dashboard', icon: <MdDashboard />, label: 'Home' },
        { to: '/record',    icon: <MdEditNote />,  label: 'Record' },
        { to: '/progress',  icon: <MdTrendingUp />, label: 'Progress' },
        { to: '/achievements', icon: <MdEmojiEvents />, label: 'Awards' },
        { to: '/profile',   icon: <MdPerson />,    label: 'Profile' },
    ];

    return (
        <>
            <aside className="sidebar">
                {/* Brand */}
                <div className="sidebar-brand">
                    <div className="sidebar-logo"><img src={logo} alt="InsuleTrack logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }} /></div>
                    <div>
                        <div className="sidebar-brand-name">InsuleTrack</div>
                        <div className="sidebar-brand-sub">Diabetes Prevention Support</div>
                    </div>
                </div>

                {/* Nav */}
                <nav className="sidebar-nav">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            className={({ isActive }) =>
                                `sidebar-link${isActive ? ' active' : ''}`
                            }
                        >
                            <span className="sidebar-link-icon">{item.icon}</span>
                            <span>{item.label}</span>
                        </NavLink>
                    ))}
                </nav>

                {/* Log Out */}
                <button className="sidebar-logout" onClick={() => setShowConfirm(true)}>
                    Log Out
                </button>
            </aside>

            {/* ── Mobile Bottom Navigation Bar ── */}
            <nav className="mobile-bottom-nav">
                {mobileNavItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                            `mobile-nav-item${isActive ? ' active' : ''}`
                        }
                    >
                        <span className="mobile-nav-icon">{item.icon}</span>
                        <span className="mobile-nav-label">{item.label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* ── Logout Confirmation Dialog ── */}
            {showConfirm && (
                <div className="logout-overlay" onClick={() => setShowConfirm(false)}>
                    <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="logout-dialog-icon">🚪</div>
                        <div className="logout-dialog-title">Log Out?</div>
                        <div className="logout-dialog-msg">
                            Are you sure you want to log out of InsuleTrack?
                        </div>
                        <div className="logout-dialog-actions">
                            <button
                                className="logout-btn-cancel"
                                onClick={() => setShowConfirm(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="logout-btn-confirm"
                                onClick={handleLogout}
                            >
                                Yes, Log Out
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
