/**
 * AdminDashboard.jsx
 *
 * Fetches REAL data from Firestore:
 *  - users collection   → Recent Users table + Total Users count
 *  - dailyLogs (all users, today's date) → Records Submitted Today count
 *
 * Mock data only for the bar chart (Daily Records last 30 days)
 * since that would require expensive queries across all subcollections.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import {
    collection, getDocs, query, orderBy, limit, doc, getDoc, setDoc,
} from 'firebase/firestore';
import AdminSidebar from '../components/AdminSidebar';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer,
} from 'recharts';
import './admin.css';

/* ── Rule Settings config ── */
const RULES = [
    {
        id: 'minActivity',
        label: 'Minimum Activity Minutes per Week',
        hint: 'Users who fall below this weekly activity threshold receive a reminder to be more active.',
        min: 0, max: 300, step: 10, defaultVal: 150,
    },
    {
        id: 'maxSugary',
        label: 'Maximum Sugary Drinks per Day',
        hint: 'Alert users who log more than this number of sugary drinks to reduce their intake.',
        min: 0, max: 10, step: 1, defaultVal: 3,
    },
    {
        id: 'weightAlert',
        label: 'Weight Change Alert (kg per week)',
        hint: 'Notify users when their weekly weight change exceeds this threshold.',
        min: 0, max: 5, step: 0.5, defaultVal: 2.5,
    },
    {
        id: 'maxFasting',
        label: 'Maximum Fasting Glucose (mg/dL)',
        hint: 'Alert users when fasting blood glucose levels exceed this threshold.',
        min: 70, max: 200, step: 5, defaultVal: 100,
    },
    {
        id: 'maxPostMeal',
        label: 'Maximum Post-Meal Glucose (mg/dL)',
        hint: 'Alert users when post-meal blood glucose levels exceed this threshold.',
        min: 100, max: 250, step: 5, defaultVal: 140,
    },
];

/* ── Helpers ── */
function relativeTime(ts) {
    if (!ts) return '—';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH} hour${diffH > 1 ? 's' : ''} ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD} day${diffD > 1 ? 's' : ''} ago`;
    const diffW = Math.floor(diffD / 7);
    return `${diffW} week${diffW > 1 ? 's' : ''} ago`;
}

function todayDateStr() {
    const d = new Date();
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}

/* ── Custom bar tooltip ── */
const BarTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="admin-chart-tooltip">
            <div className="admin-tooltip-label">{label}</div>
            <div className="admin-tooltip-val">{payload[0].value} records</div>
        </div>
    );
};

export default function AdminDashboard() {
    const navigate = useNavigate();
    const [adminUser, setAdminUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [recordsToday, setRecordsToday] = useState(0);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [rules, setRules] = useState(() =>
        Object.fromEntries(RULES.map((r) => [r.id, r.defaultVal]))
    );
    const [saveMsg, setSaveMsg] = useState('');
    const [showLogout, setShowLogout] = useState(false);
    const [chartData, setChartData] = useState([]);
    const [chartLoading, setChartLoading] = useState(true);

    /* ── Fetch all users from Firestore ── */
    const fetchUsers = useCallback(async () => {
        setLoadingUsers(true);
        try {
            const snap = await getDocs(
                query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(50))
            );
            const list = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
            setUsers(list);
            setTotalUsers(snap.size);
        } catch {
            try {
                const fallbackSnap = await getDocs(collection(db, 'users'));
                const list = fallbackSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
                setUsers(list);
                setTotalUsers(fallbackSnap.size);
            } catch { /* ignore */ }
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    /* ── Fetch real 30-day daily records chart ── */
    const fetchChartData = useCallback(async (userList) => {
        setChartLoading(true);
        try {
            // Build a map: dateStr → count of users who logged on that day
            const countMap = {};
            const last30 = [];
            for (let i = 29; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const dateStr = [
                    d.getFullYear(),
                    String(d.getMonth() + 1).padStart(2, '0'),
                    String(d.getDate()).padStart(2, '0'),
                ].join('-');
                countMap[dateStr] = 0;
                last30.push(dateStr);
            }

            // For each user fetch their log doc IDs and increment the count
            await Promise.all(userList.map(async (u) => {
                try {
                    const logsSnap = await getDocs(collection(db, 'users', u.uid, 'dailyLogs'));
                    logsSnap.docs.forEach((d) => {
                        if (countMap[d.id] !== undefined) countMap[d.id]++;
                    });
                } catch { /* skip */ }
            }));

            const chartPoints = last30.map((dateStr) => {
                const d = new Date(dateStr + 'T00:00:00');
                const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return { day: label, records: countMap[dateStr] };
            });
            setChartData(chartPoints);
        } catch (err) {
            console.error('[AdminDashboard] chart fetch error:', err);
        } finally {
            setChartLoading(false);
        }
    }, []);

    /* ── Load saved rules from Firestore ── */
    const loadRules = useCallback(async () => {
        try {
            const snap = await getDoc(doc(db, 'adminSettings', 'rules'));
            if (snap.exists()) {
                const saved = snap.data();
                setRules((prev) => {
                    const merged = { ...prev };
                    RULES.forEach((r) => {
                        if (saved[r.id] !== undefined) merged[r.id] = saved[r.id];
                    });
                    return merged;
                });
            }
        } catch { /* use defaults */ }
    }, []);

    /* ── Count today's records across all users ── */
    const fetchTodayRecords = useCallback(async (userList) => {
        if (!userList.length) return;
        const today = todayDateStr();
        let count = 0;
        // For each user, check if they have a dailyLog for today
        const checks = userList.map(async (u) => {
            try {
                const logSnap = await getDocs(
                    query(collection(db, 'users', u.uid, 'dailyLogs'))
                );
                logSnap.docs.forEach((doc) => {
                    if (doc.id === today) count++;
                });
            } catch { /* skip */ }
        });
        await Promise.all(checks);
        setRecordsToday(count);
    }, []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) { navigate('/login'); return; }
            const snap = await getDoc(doc(db, 'users', u.uid));
            if (!snap.exists() || snap.data().role !== 'admin') { navigate('/dashboard'); return; }
            setAdminUser(u);
            await fetchUsers();
            await loadRules();
        });
        return () => unsub();
    }, [navigate, fetchUsers, loadRules]);

    // Once users are loaded, count today's records AND build the chart
    useEffect(() => {
        if (users.length > 0) {
            fetchTodayRecords(users);
            fetchChartData(users);
        }
    }, [users, fetchTodayRecords, fetchChartData]);

    const handleSaveRules = async (e) => {
        e.preventDefault();
        try {
            await setDoc(doc(db, 'adminSettings', 'rules'), rules, { merge: true });
            setSaveMsg('✅ Rule settings saved successfully!');
        } catch (err) {
            setSaveMsg('❌ Save failed: ' + err.message);
        }
        setTimeout(() => setSaveMsg(''), 3500);
    };

    const handleResetRules = () => {
        setRules(Object.fromEntries(RULES.map((r) => [r.id, r.defaultVal])));
    };

    const handleLogout = async () => {
        await signOut(auth);
        navigate('/login');
    };

    const adminName = adminUser?.displayName || adminUser?.email?.split('@')[0] || 'Admin';
    const adminInitials = adminName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

    // Active users = those whose lastLogin, updatedAt, or createdAt is within last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const activeCount = users.filter((u) => {
        const ts = u.lastLogin || u.updatedAt || u.createdAt;
        if (!ts) return false;
        const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
        return ms >= sevenDaysAgo;
    }).length;

    return (
        <>
            <div className="admin-layout">
                <AdminSidebar onLogout={() => setShowLogout(true)} />

                <div className="admin-main">
                    {/* ── Top Bar ── */}
                    <header className="admin-topbar">
                        <div className="admin-topbar-left">
                            <div className="admin-page-title">Administrator Dashboard</div>
                            <div className="admin-page-sub">Monitor system usage and manage settings</div>
                        </div>
                        <div className="admin-topbar-right">
                            <div className="admin-user-info">
                                <div className="admin-user-label">Admin User</div>
                                <div className="admin-user-email">{adminUser?.email}</div>
                            </div>
                            <div className="admin-avatar">{adminInitials || 'A'}</div>
                        </div>
                    </header>

                    <div className="admin-body">
                        {/* ── Stats Row ── */}
                        <div className="admin-stats-row">
                            <div className="admin-stat-card">
                                <div className="admin-stat-icon blue">👥</div>
                                <div className="admin-stat-body">
                                    <div className="admin-stat-label">Total Registered Users</div>
                                    <div className="admin-stat-val">
                                        {loadingUsers ? '…' : totalUsers.toLocaleString()}
                                    </div>
                                </div>
                                <div className="admin-stat-badge green">Live</div>
                            </div>
                            <div className="admin-stat-card">
                                <div className="admin-stat-icon purple">⚡</div>
                                <div className="admin-stat-body">
                                    <div className="admin-stat-label">Active Users This Week</div>
                                    <div className="admin-stat-val">
                                        {loadingUsers ? '…' : activeCount}
                                    </div>
                                </div>
                                <div className="admin-stat-badge green">Live</div>
                            </div>
                            <div className="admin-stat-card">
                                <div className="admin-stat-icon teal">📋</div>
                                <div className="admin-stat-body">
                                    <div className="admin-stat-label">Records Submitted Today</div>
                                    <div className="admin-stat-val">{recordsToday}</div>
                                </div>
                                <div className="admin-stat-badge green">Live</div>
                            </div>
                        </div>

                        {/* ── Two-column content ── */}
                        <div className="admin-content-row">
                            {/* Left – Bar Chart (real Firestore data) */}
                            <div className="admin-chart-card">
                                <div className="admin-card-title">Daily Records (Last 30 Days)</div>
                                {chartLoading ? (
                                    <div className="admin-loading">Loading chart data…</div>
                                ) : chartData.every((d) => d.records === 0) ? (
                                    <div className="admin-empty" style={{ padding: '40px 0' }}>
                                        No daily records logged yet in the last 30 days.
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={240}>
                                        <BarChart
                                            data={chartData}
                                            margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                            <XAxis
                                                dataKey="day"
                                                tick={{ fontSize: 9, fill: '#9CA3AF' }}
                                                axisLine={false}
                                                tickLine={false}
                                                interval={4}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                                                axisLine={false}
                                                tickLine={false}
                                                allowDecimals={false}
                                            />
                                            <Tooltip content={<BarTooltip />} />
                                            <Bar
                                                dataKey="records"
                                                fill="url(#barGrad)"
                                                radius={[4, 4, 0, 0]}
                                            />
                                            <defs>
                                                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#10B981" />
                                                    <stop offset="100%" stopColor="#3B82F6" />
                                                </linearGradient>
                                            </defs>
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>

                            {/* Right – Recent Users (REAL from Firestore) */}
                            <div className="admin-users-card">
                                <div className="admin-card-title-row">
                                    <div className="admin-card-title">Recent Users</div>
                                    <button
                                        className="admin-refresh-btn"
                                        onClick={fetchUsers}
                                        title="Refresh users"
                                    >
                                        ↻ Refresh
                                    </button>
                                </div>

                                {loadingUsers ? (
                                    <div className="admin-loading">Loading users…</div>
                                ) : users.length === 0 ? (
                                    <div className="admin-empty">No registered users yet.</div>
                                ) : (
                                    <table className="admin-users-table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                <th>Email</th>
                                                <th>Status</th>
                                                <th>Joined</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {users.slice(0, 10).map((u) => {
                                                // Prefer lastLogin for activity, fall back to updatedAt → createdAt
                                                const ts = u.lastLogin || u.updatedAt || u.createdAt;
                                                const ms = ts?.toDate
                                                    ? ts.toDate().getTime()
                                                    : ts ? new Date(ts).getTime() : 0;
                                                const isActive = ms >= sevenDaysAgo;
                                                return (
                                                    <tr key={u.uid}>
                                                        <td className="admin-user-name-cell">
                                                            {u.fullName || u.displayName || '—'}
                                                        </td>
                                                        <td className="admin-email-cell">
                                                            {u.email || '—'}
                                                        </td>
                                                        <td>
                                                            <span className={`admin-status-badge ${isActive ? 'active' : 'inactive'}`}>
                                                                {isActive ? '● active' : '● inactive'}
                                                            </span>
                                                        </td>
                                                        <td className="admin-login-cell">
                                                            {relativeTime(u.createdAt)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>

                        {/* ── Rule Settings ── */}
                        <div className="admin-rules-card">
                            <div className="admin-rules-header">
                                <div className="admin-rules-icon">⚙️</div>
                                <div>
                                    <div className="admin-card-title" style={{ marginBottom: 2 }}>
                                        Rule Settings
                                    </div>
                                    <div className="admin-rules-sub">
                                        Configure thresholds for recommendations and alerts
                                    </div>
                                </div>
                            </div>

                            <form onSubmit={handleSaveRules}>
                                <div className="admin-rules-list">
                                    {RULES.map((rule) => (
                                        <div key={rule.id} className="admin-rule-row">
                                            <div className="admin-rule-meta">
                                                <div className="admin-rule-label">{rule.label}</div>
                                                <div className="admin-rule-hint">{rule.hint}</div>
                                            </div>
                                            <div className="admin-rule-control">
                                                <input
                                                    type="range"
                                                    className="admin-slider"
                                                    min={rule.min}
                                                    max={rule.max}
                                                    step={rule.step}
                                                    value={rules[rule.id]}
                                                    onChange={(e) =>
                                                        setRules((prev) => ({
                                                            ...prev,
                                                            [rule.id]: Number(e.target.value),
                                                        }))
                                                    }
                                                />
                                                <div className="admin-rule-val">{rules[rule.id]}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {saveMsg && <div className="admin-save-msg">{saveMsg}</div>}

                                <div className="admin-rules-actions">
                                    <button type="submit" className="admin-btn-save">
                                        Save Changes
                                    </button>
                                    <button
                                        type="button"
                                        className="admin-btn-reset"
                                        onClick={handleResetRules}
                                    >
                                        ↺ Reset
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Logout Confirmation Dialog ── */}
            {showLogout && (
                <div className="logout-overlay" onClick={() => setShowLogout(false)}>
                    <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="logout-dialog-icon">🚪</div>
                        <div className="logout-dialog-title">Log Out?</div>
                        <div className="logout-dialog-msg">
                            Are you sure you want to log out of the Admin Console?
                        </div>
                        <div className="logout-dialog-actions">
                            <button
                                className="logout-btn-cancel"
                                onClick={() => setShowLogout(false)}
                            >
                                Cancel
                            </button>
                            <button className="logout-btn-confirm" onClick={handleLogout}>
                                Yes, Log Out
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
