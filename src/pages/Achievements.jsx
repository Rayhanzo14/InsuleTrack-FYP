import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import Sidebar from '../components/Sidebar';
import TopHeader from '../components/TopHeader';
import { useStreak } from '../hooks/useStreak';
import '../dashboard.css';
import '../achievements.css';

/* ── Category colour map (covers built-in + any admin-created category) ── */
const CATEGORY_COLORS = {
    tracking:    { bg: '#DBEAFE', text: '#1D4ED8', label: 'Tracking' },
    consistency: { bg: '#EDE9FE', text: '#6D28D9', label: 'Consistency' },
    activity:    { bg: '#D1FAE5', text: '#059669', label: 'Activity' },
    health:      { bg: '#FCE7F3', text: '#BE185D', label: 'Health' },
};

/** Resolve colour for any category string (case-insensitive). Falls back to grey. */
function catColor(categoryRaw) {
    if (!categoryRaw) return { bg: '#F3F4F6', text: '#6B7280', label: categoryRaw || '—' };
    const key = categoryRaw.toLowerCase();
    return CATEGORY_COLORS[key] ?? { bg: '#F3F4F6', text: '#6B7280', label: categoryRaw };
}

/**
 * Compute progress values from the user's daily-log stats + streak data.
 * Matched against achievement titles (same titles used by admin seeder).
 */
function computeProgress(title, category, total, currentStreak, totalDays, stats) {
    const {
        totalLogs, actCount, act30Count, stepDays, stepChampionDays,
        totalSteps, bsCount, weightCount, mealCount, waterCount,
    } = stats;

    const t = title.trim();
    // Match by canonical title strings — same titles as the admin DEFAULT_ACHIEVEMENTS
    switch (t) {
        case 'First Steps':        return totalDays;
        case 'Early Bird':         return 0;           // no timestamp data available
        case 'Lifestyle Legend':   return totalLogs;
        case 'Week Warrior':       return currentStreak;
        case 'Two Week Streak':    return currentStreak;
        case 'Month Master':       return currentStreak;
        case 'Health Champion':    return currentStreak;
        case 'Prevention Hero':    return currentStreak;
        case 'Active Starter':     return actCount;
        case 'Fitness Enthusiast': return actCount;
        case 'Fitness Guru':       return act30Count;
        case 'Step Starter':       return stepDays;
        case 'Step Champion':      return stepChampionDays;
        case 'Step Master':        return stepChampionDays;
        case 'Walking Legend':     return totalSteps;
        case 'Sugar Monitor':      return bsCount;
        case 'Sugar Expert':       return bsCount;
        case 'Weight Tracker':     return weightCount;
        case 'Balanced Eater':     return mealCount;
        case 'Hydration Hero':     return waterCount;
        default:
            // Unknown / custom admin achievement — progress not computable yet; show 0
            return 0;
    }
}

const EMPTY_STATS = {
    totalLogs: 0, actCount: 0, act30Count: 0,
    stepDays: 0, stepChampionDays: 0, totalSteps: 0,
    bsCount: 0, weightCount: 0, mealCount: 0, waterCount: 0,
};

export default function Achievements() {
    const navigate = useNavigate();
    const [user, setUser]               = useState(null);
    const [statusFilter, setStatus]     = useState('All');
    const [categoryFilter, setCategory] = useState('All Categories');
    const [stats, setStats]             = useState(null);
    const [logsLoading, setLogsLoading] = useState(true);

    // Achievements fetched live from Firestore
    const [achievements, setAchievements] = useState([]);
    const [achLoading, setAchLoading]     = useState(true);

    /* ── Auth guard ── */
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) { navigate('/login'); return; }
            setUser(u);
        });
        return () => unsub();
    }, [navigate]);

    /* ── Live listener on achievements collection ─────────────────────────
       onSnapshot keeps the user page in sync the moment admin adds/removes
       an achievement — no page refresh needed.
    ── */
    useEffect(() => {
        setAchLoading(true);
        const unsub = onSnapshot(
            collection(db, 'achievements'),
            (snap) => {
                const docs = snap.docs.map((d) => ({ firestoreId: d.id, ...d.data() }));
                // Sort by createdAt so order is stable
                docs.sort((a, b) => {
                    const ta = a.createdAt?.seconds ?? 0;
                    const tb = b.createdAt?.seconds ?? 0;
                    return ta - tb;
                });
                setAchievements(docs);
                setAchLoading(false);
            },
            (err) => {
                console.error('Achievements listener error:', err);
                setAchLoading(false);
            }
        );
        return () => unsub();
    }, []);

    /* ── Fetch dailyLogs and compute stats ── */
    const fetchStats = useCallback(async (uid) => {
        setLogsLoading(true);
        try {
            const snap = await getDocs(collection(db, 'users', uid, 'dailyLogs'));
            let totalLogs = 0, actCount = 0, act30Count = 0;
            let stepDays = 0, stepChampionDays = 0, totalSteps = 0;
            let bsCount = 0, weightCount = 0, mealCount = 0, waterCount = 0;

            snap.docs.forEach((d) => {
                const data = d.data();
                totalLogs++;

                const dur = data.physicalActivity?.activityDuration ?? 0;
                if (dur > 0) actCount++;
                if (dur >= 30) act30Count++;

                // Fix: RecordData.jsx saves steps as physicalActivity.dailySteps
                const steps = data.physicalActivity?.dailySteps ?? 0;
                if (steps > 0) stepDays++;
                if (steps >= 10000) stepChampionDays++;
                totalSteps += steps;

                if (data.bloodSugar?.fastingGlucose || data.bloodSugar?.postMealGlucose) bsCount++;
                if (data.bodyMeasurement?.weight) weightCount++;

                const fi = data.foodIntake || {};
                mealCount += [fi.breakfast, fi.lunch, fi.dinner, fi.snacks].filter(Boolean).length;
                if ((fi.waterIntake ?? 0) >= 8) waterCount++;
            });

            setStats({ totalLogs, actCount, act30Count, stepDays, stepChampionDays, totalSteps, bsCount, weightCount, mealCount, waterCount });
        } catch (err) {
            console.error('Achievements: failed to fetch logs', err);
            setStats(EMPTY_STATS);
        } finally {
            setLogsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user?.uid) fetchStats(user.uid);
    }, [user, fetchStats]);

    /* ── Real streak ── */
    const {
        current: currentStreak,
        best: bestStreak,
        total: totalDays,
        checkedInToday,
        checkingIn,
        checkIn,
        loading: streakLoading,
    } = useStreak(user?.uid);

    const loading = logsLoading || streakLoading || achLoading;

    /* ── Build derived data ── */
    const safeStats = stats ?? EMPTY_STATS;

    const achievementsWithProgress = achievements.map((a) => {
        const prog = computeProgress(
            a.title, a.category, a.total,
            currentStreak, totalDays, safeStats
        );
        const total     = Number(a.total) || 1;
        const pct       = Math.min((prog / total) * 100, 100);
        const isEarned  = prog >= total;
        const isLarge   = total >= 10000;
        const col       = catColor(a.category);
        return { ...a, prog, total, pct, isEarned, isLarge, col };
    });

    /* ── Summary ── */
    const earned         = achievementsWithProgress.filter((a) => a.isEarned).length;
    const completionRate = achievements.length > 0 ? Math.round((earned / achievements.length) * 100) : 0;

    /* ── Unique categories from Firestore data (for filter dropdown) ── */
    const uniqueCategories = ['All Categories', ...new Set(achievements.map((a) => a.category).filter(Boolean))];

    /* ── Filters ── */
    const filtered = achievementsWithProgress.filter((a) => {
        if (statusFilter === 'Earned' && !a.isEarned) return false;
        if (statusFilter === 'Locked' && a.isEarned) return false;
        if (categoryFilter !== 'All Categories' && a.category !== categoryFilter) return false;
        return true;
    });

    return (
        <div className="db-layout">
            <Sidebar />
            <div className="db-main">
                <TopHeader user={user} />

                <div className="db-body">
                    {/* Title */}
                    <div>
                        <div className="db-page-title">🏆 Achievements &amp; Badges</div>
                        <div className="db-page-sub">Track your progress and earn badges for healthy lifestyle habits</div>
                    </div>

                    {/* Check-in banner */}
                    {!loading && !checkedInToday && (
                        <div className="alert-banner">
                            <span>⚠️</span>
                            <span>
                                Check in daily to build your streak and unlock achievements!{' '}
                                <button
                                    onClick={checkIn}
                                    disabled={checkingIn}
                                    style={{ color: '#059669', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                >
                                    {checkingIn ? 'Saving…' : 'Check In Now'}
                                </button>
                            </span>
                        </div>
                    )}
                    {!loading && checkedInToday && (
                        <div className="alert-banner" style={{ background: '#ECFDF5', borderColor: '#A7F3D0', color: '#065F46' }}>
                            <span>✅</span> You've checked in today! Current streak: <strong>{currentStreak} {currentStreak === 1 ? 'day' : 'days'}</strong>
                        </div>
                    )}

                    {/* ── Summary Cards ── */}
                    <div className="ach-summary-row">
                        <div className="ach-summary-card orange">
                            <div className="ach-summary-icon">⭐</div>
                            <div className="ach-summary-val">{loading ? '…' : earned}</div>
                            <div className="ach-summary-label">Badges Earned</div>
                        </div>
                        <div className="ach-summary-card purple">
                            <div className="ach-summary-icon">🏅</div>
                            <div className="ach-summary-val">{loading ? '…' : achievements.length}</div>
                            <div className="ach-summary-label">Total Achievements</div>
                        </div>
                        <div className="ach-summary-card green">
                            <div className="ach-summary-icon">📈</div>
                            <div className="ach-summary-val">{loading ? '…' : `${completionRate}%`}</div>
                            <div className="ach-summary-label">Completion Rate</div>
                        </div>
                        <div className="ach-summary-card blue">
                            <div className="ach-summary-icon">🔥</div>
                            <div className="ach-summary-val">{loading ? '…' : bestStreak}</div>
                            <div className="ach-summary-label">Best Streak (days)</div>
                        </div>
                    </div>

                    {/* ── Filters ── */}
                    <div className="ach-filters">
                        <div className="ach-filter-group">
                            <span className="ach-filter-label">Filter by Status</span>
                            <div className="ach-tab-row">
                                {['All', 'Earned', 'Locked'].map((s) => (
                                    <button
                                        key={s}
                                        className={`ach-tab${statusFilter === s ? ' active' : ''}`}
                                        onClick={() => setStatus(s)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="ach-filter-group">
                            <span className="ach-filter-label">Filter by Category</span>
                            <select
                                className="ach-select"
                                value={categoryFilter}
                                onChange={(e) => setCategory(e.target.value)}
                            >
                                {uniqueCategories.map((c) => <option key={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* ── Loading ── */}
                    {loading && (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
                            <div className="spinner" style={{ margin: '0 auto 12px', width: 28, height: 28, borderWidth: 3 }} />
                            Loading your achievements…
                        </div>
                    )}

                    {/* ── Badge Grid ── */}
                    {!loading && filtered.length === 0 && (
                        <div className="ach-empty">
                            <div style={{ fontSize: 48, marginBottom: 12 }}>🏅</div>
                            <div style={{ fontWeight: 600, color: '#374151' }}>No achievements found</div>
                            <div style={{ color: '#9CA3AF', fontSize: 13, marginTop: 6 }}>Try changing your filters</div>
                        </div>
                    )}

                    {!loading && filtered.length > 0 && (
                        <div className="ach-grid">
                            {filtered.map((a) => (
                                <div key={a.firestoreId} className={`ach-card${a.isEarned ? ' earned' : ''}`}>
                                    {/* Lock / unlock icon */}
                                    <div className="ach-card-top">
                                        <div className={`ach-badge-icon${a.isEarned ? ' earned' : ''}`}>
                                            {a.isEarned ? a.icon : '🔒'}
                                        </div>
                                        <div className={`ach-lock-icon${a.isEarned ? ' earned' : ''}`}>
                                            {a.isEarned ? '✅' : '🔒'}
                                        </div>
                                    </div>

                                    <div className="ach-card-body">
                                        <div className="ach-card-title">{a.title}</div>
                                        <div className="ach-card-desc">{a.desc}</div>
                                        <span
                                            className="ach-category-badge"
                                            style={{ background: a.col.bg, color: a.col.text }}
                                        >
                                            {a.col.label}
                                        </span>
                                    </div>

                                    {/* Progress */}
                                    <div className="ach-card-footer">
                                        <div className="ach-prog-row">
                                            <span className="ach-prog-label">Progress</span>
                                            <span className="ach-prog-val">
                                                {a.isLarge
                                                    ? `${a.prog.toLocaleString()} / ${a.total.toLocaleString()}`
                                                    : `${a.prog} / ${a.total}`}
                                            </span>
                                        </div>
                                        <div className="ach-prog-bar">
                                            <div
                                                className={`ach-prog-fill${a.isEarned ? ' earned' : ''}`}
                                                style={{ width: `${a.pct}%` }}
                                            />
                                        </div>
                                        {a.isEarned && (
                                            <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginTop: 6, textAlign: 'center' }}>
                                                🎉 Achievement Unlocked!
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
