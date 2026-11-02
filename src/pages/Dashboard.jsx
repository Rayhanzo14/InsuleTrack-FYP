import React, { useEffect, useState, useRef, useMemo } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useNavigate, Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { useStreak } from '../hooks/useStreak';
import DiabetesRiskCard from '../components/DiabetesRiskCard';
import ConfettiCelebration from '../components/ConfettiCelebration';
import '../dashboard.css';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
    Legend, ResponsiveContainer
} from 'recharts';

// ─── Streak badge milestone labels ──────────────────────────
function streakLabel(n) {
    if (n === 0) return "Start your journey today!";
    if (n < 3) return "Great start, keep going!";
    if (n < 7) return "Building momentum! 🔥";
    if (n >= 7)  return "One week strong! 💪";
    if (n >= 14) return "Two week streak! 🏆";
    if (n < 90) return "Month master! ⭐";
    return "Health legend! 🌟";
}

// ─── Generate smart recommendations from real data ───────────
function buildRecommendations(todayLog) {
    const recs = [];
    const water    = todayLog?.foodIntake?.waterIntake ?? null;
    const activity = todayLog?.physicalActivity?.activityDuration ?? null;
    const fasting  = todayLog?.bloodSugar?.fastingGlucose ?? null;

    if (water === null) {
        recs.push({ icon: '💧', title: 'Log your water intake', desc: "You haven't logged your water intake today. Aim for at least 8 glasses." });
    } else if (water < 6) {
        recs.push({ icon: '💧', title: 'Drink more water', desc: `You've had ${water} glasses today. Try to reach at least 8 glasses for optimal hydration.` });
    } else {
        recs.push({ icon: '💧', title: 'Great hydration!', desc: `You've had ${water} glasses today. Keep it up!` });
    }

    if (activity === null) {
        recs.push({ icon: '🏃', title: 'Log your activity', desc: "Track your exercise today. Aim for at least 30 minutes of moderate activity." });
    } else if (activity < 30) {
        recs.push({ icon: '🏃', title: 'Increase your activity', desc: `You've logged ${activity} minutes today. Try to reach 30+ minutes for optimal health.` });
    } else {
        recs.push({ icon: '✅', title: 'Active day!', desc: `${activity} minutes of activity logged. Excellent work keeping up your fitness!` });
    }

    if (fasting !== null && fasting > 100) {
        recs.push({ icon: '🩸', title: 'Fasting glucose elevated', desc: `Your fasting glucose is ${fasting} mg/dL (above 100). Consider consulting your doctor.` });
    } else if (fasting !== null) {
        recs.push({ icon: '✅', title: 'Glucose in healthy range', desc: `Fasting glucose at ${fasting} mg/dL — within the normal range. Keep up your healthy habits!` });
    } else {
        recs.push({ icon: '🩸', title: 'Track your blood sugar', desc: 'Log your fasting glucose today for a personalised risk assessment.' });
    }

    return recs.slice(0, 3);
}

// ─── Format steps display ─────────────────────────────────────
function formatSteps(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
}

// ─── Get last 7 calendar days (YYYY-MM-DD) ───────────────────
function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    return days;
}

// ─── Short day label (Mon, Tue …) ─────────────────────────────
function dayLabel(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

// ─── Daily Health Score (0–100) ───────────────────────────────
function calcHealthScore(log) {
    if (!log) return { score: 0, breakdown: [] };
    let score = 0;
    const breakdown = [];
    const bs    = !!(log.bloodSugar?.fastingGlucose || log.bloodSugar?.postMealGlucose);
    const fi    = log.foodIntake || {};
    const meals = !!(fi.breakfast || fi.lunch || fi.dinner);
    const water = (fi.waterIntake ?? 0) >= 8;
    const act   = (log.physicalActivity?.activityDuration ?? 0) >= 30;
    const wt    = !!log.bodyMeasurement?.weight;
    if (bs)    { score += 20; breakdown.push({ label: 'Blood Sugar',      pts: 20, done: true }); }
    else                        breakdown.push({ label: 'Blood Sugar',      pts: 20, done: false });
    if (meals) { score += 20; breakdown.push({ label: 'Meals Logged',     pts: 20, done: true }); }
    else                        breakdown.push({ label: 'Meals Logged',     pts: 20, done: false });
    if (water) { score += 20; breakdown.push({ label: 'Hydration (8+)',   pts: 20, done: true }); }
    else                        breakdown.push({ label: 'Hydration (8+)',   pts: 20, done: false });
    if (act)   { score += 20; breakdown.push({ label: 'Activity (30min)', pts: 20, done: true }); }
    else                        breakdown.push({ label: 'Activity (30min)', pts: 20, done: false });
    if (wt)    { score += 20; breakdown.push({ label: 'Weight',            pts: 20, done: true }); }
    else                        breakdown.push({ label: 'Weight',            pts: 20, done: false });
    return { score, breakdown };
}
function scoreColor(s) {
    if (s >= 80) return '#10B981';
    if (s >= 60) return '#F59E0B';
    if (s >= 40) return '#F97316';
    return '#EF4444';
}
function scoreLabel(s) {
    if (s === 100) return 'Perfect day! 🌟';
    if (s >= 80)   return 'Excellent! 🎉';
    if (s >= 60)   return 'Good progress 👍';
    if (s >= 40)   return 'Keep going 💪';
    if (s > 0)     return 'Just starting 🌱';
    return 'Start logging today!';
}

// ─── Streak milestone confetti triggers ───────────────────────
const STREAK_MILESTONES = [1, 3, 7, 14, 30, 60, 90];
const MILESTONE_LABELS  = {
    1: 'First Check-in! 🎉', 3: '3-Day Streak! 🔥', 7: 'Week Warrior! 💪',
    14: 'Two Week Streak! 🏆', 30: 'Month Master! ⭐', 60: 'Prevention Hero! 🛡️', 90: 'Health Champion! 🏅',
};

export default function Dashboard() {

    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);

    // Real data states
    const [todayLog, setTodayLog] = useState(null);
    const [weeklyData, setWeeklyData] = useState([]);
    const [stepsStats, setStepsStats] = useState({ avg: 0, total: 0, daysTracked: 0, tenKDays: 0 });
    const [logsLoading, setLogsLoading] = useState(true);

    // Confetti state
    const [confetti, setConfetti] = useState(false);
    const [milestoneMsg, setMilestoneMsg] = useState('');
    const celebratedRef = useRef(new Set()); // milestones already celebrated this session

    // Auth guard + fetch profile
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
            if (!firebaseUser) { navigate('/login'); return; }
            setUser(firebaseUser);
            try {
                const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
                if (snap.exists()) setProfile(snap.data());
            } catch { /* use defaults */ }
        });
        return () => unsub();
    }, [navigate]);

    // Fetch daily logs when user is known
    useEffect(() => {
        if (!user?.uid) return;

        async function fetchLogs() {
            setLogsLoading(true);
            try {
                const logsRef = collection(db, 'users', user.uid, 'dailyLogs');
                const q = query(logsRef, orderBy('date', 'desc'), limit(30));
                const snap = await getDocs(q);

                const allLogs = {};
                snap.forEach((d) => { allLogs[d.id] = d.data(); });

                // ── Today's log ──────────────────────────────────
                const todayStr = new Date().toISOString().slice(0, 10);
                setTodayLog(allLogs[todayStr] ?? null);

                // ── Last 7 days chart data ───────────────────────
                const last7 = getLast7Days();
                const chart = last7.map((dateStr) => {
                    const log = allLogs[dateStr];
                    return {
                        day: dayLabel(dateStr),
                        date: dateStr,
                        activity: log?.physicalActivity?.activityDuration ?? null,
                        fasting:  log?.bloodSugar?.fastingGlucose ?? null,
                        postMeal: log?.bloodSugar?.postMealGlucose ?? null,
                        water:    log?.foodIntake?.waterIntake ?? null,
                    };
                });
                setWeeklyData(chart);

                // ── Steps stats (all fetched logs) ───────────────
                const stepDays = Object.values(allLogs).filter(
                    (l) => l?.physicalActivity?.dailySteps != null
                );
                const totalSteps = stepDays.reduce((sum, l) => sum + (l.physicalActivity.dailySteps || 0), 0);
                const tenKDays   = stepDays.filter((l) => l.physicalActivity.dailySteps >= 10000).length;
                setStepsStats({
                    avg: stepDays.length > 0 ? Math.round(totalSteps / stepDays.length) : 0,
                    total: totalSteps,
                    daysTracked: stepDays.length,
                    tenKDays,
                });
            } catch (err) {
                console.error('[Dashboard] fetch logs error:', err);
            } finally {
                setLogsLoading(false);
            }
        }

        fetchLogs();
    }, [user?.uid]);

    // ── Real streak data ─────────────────────────────────────
    const {
        current: currentStreak,
        best: bestStreak,
        total: totalDays,
        checkedInToday,
        checkingIn,
        checkInError,
        checkIn,
    } = useStreak(user?.uid);

    // ── Confetti on streak milestone ──────────────────────
    useEffect(() => {
        if (!currentStreak || !checkedInToday) return;
        const hit = STREAK_MILESTONES.filter(
            (m) => currentStreak === m && !celebratedRef.current.has(m)
        );
        if (hit.length > 0) {
            const m = hit[hit.length - 1];
            celebratedRef.current.add(m);
            setMilestoneMsg(MILESTONE_LABELS[m] ?? '🎉 Milestone reached!');
            setConfetti(true);
        }
    }, [currentStreak, checkedInToday]);
    // 6 streak achievements: 1-day, 7-day, 14-day, 30-day, 60-day, 90-day
    const STREAK_ACH_TOTAL = 6;
    const streakAchsEarned = [
        currentStreak >= 1,
        currentStreak >= 7,
        currentStreak >= 14,
        currentStreak >= 30,
        currentStreak >= 90,
        currentStreak >= 60,
    ].filter(Boolean).length;
    const achProgress = Math.round((streakAchsEarned / STREAK_ACH_TOTAL) * 100);

    const displayName =
        profile?.fullName || user?.displayName || user?.email?.split('@')[0] || 'User';
    const initials = displayName
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    // ── Derived values for stat cards ───────────────────────
    const todayWater    = todayLog?.foodIntake?.waterIntake ?? null;
    const todayActivity = todayLog?.physicalActivity?.activityDuration ?? null;
    // Weight: prefer today's log, fall back to profile
    const todayWeight   = todayLog?.bodyMeasurement?.weight
        ?? (profile?.weight ? Number(profile.weight) : null);

    // ── Smart recommendations ────────────────────────────────
    const recommendations = buildRecommendations(todayLog);

    // ── Today's log summary ──────────────────────────────────
    const loggedItems = [
        { label: 'Blood Sugar',       logged: !!(todayLog?.bloodSugar?.fastingGlucose || todayLog?.bloodSugar?.postMealGlucose) },
        { label: 'Meals / Food',      logged: !!(todayLog?.foodIntake?.breakfast || todayLog?.foodIntake?.lunch || todayLog?.foodIntake?.dinner) },
        { label: 'Water Intake',      logged: todayLog?.foodIntake?.waterIntake != null },
        { label: 'Physical Activity', logged: !!(todayLog?.physicalActivity?.activityDuration || todayLog?.physicalActivity?.dailySteps) },
    ];

    // ── Daily Health Score ──────────────────────────────
    const { score: healthScore, breakdown: scoreBreakdown } = useMemo(
        () => calcHealthScore(todayLog),
        [todayLog]
    );

    // ── How many log items done today ────────────────────
    const loggedCount = loggedItems.filter((i) => i.logged).length;

    const noChartData = weeklyData.every(
        (d) => d.activity === null && d.fasting === null && d.postMeal === null && d.water === null
    );

    return (
        <div className="db-layout">
            <Sidebar />

            {/* ── Confetti overlay ── */}
            <ConfettiCelebration
                active={confetti}
                onDone={() => setConfetti(false)}
            />
            {confetti && milestoneMsg && (
                <div className="milestone-toast">
                    🎉 {milestoneMsg}
                </div>
            )}

            <div className="db-main">
                {/* ── Top Header ── */}
                <header className="db-header">
                    <div className="db-header-left">
                        <div className="streak-badge">
                            🔥 Streak: <strong>{currentStreak} {currentStreak === 1 ? 'day' : 'days'}</strong>
                        </div>
                    </div>
                    <div className="db-header-right">
                        <div className="user-info">
                            <div className="user-name">{displayName}</div>
                            <div className="user-email">{user?.email}</div>
                        </div>
                        <div className="user-avatar">{initials}</div>
                    </div>
                </header>

                {/* ── Body ── */}
                <div className="db-body">
                    {/* Page title */}
                    <div>
                        <div className="db-page-title">Dashboard</div>
                        <div className="db-page-sub">Track your daily progress and health metrics</div>
                    </div>

                    {/* ── Daily Health Score ── */}
                    {!logsLoading && (
                        <div className="health-score-card">
                            <div className="health-score-left">
                                <div className="health-score-label">Today's Health Score</div>
                                <div
                                    className="health-score-number"
                                    style={{ color: scoreColor(healthScore) }}
                                >
                                    {healthScore}
                                    <span className="health-score-max">/100</span>
                                </div>
                                <div className="health-score-caption">{scoreLabel(healthScore)}</div>
                                <div className="health-score-bar-wrap">
                                    <div
                                        className="health-score-bar-fill"
                                        style={{
                                            width: `${healthScore}%`,
                                            background: scoreColor(healthScore),
                                        }}
                                    />
                                </div>
                                <div className="health-score-sub">
                                    {loggedCount}/5 items logged today
                                </div>
                            </div>
                            <div className="health-score-breakdown">
                                {scoreBreakdown.map((b) => (
                                    <div key={b.label} className={`score-item ${b.done ? 'done' : 'todo'}`}>
                                        <span className="score-item-icon">{b.done ? '✅' : '○'}</span>
                                        <span className="score-item-label">{b.label}</span>
                                        <span className="score-item-pts" style={{ color: b.done ? scoreColor(healthScore) : '#D1D5DB' }}>
                                            +{b.pts}
                                        </span>
                                    </div>
                                ))}
                                <Link to="/record" className="score-log-btn">
                                    {healthScore === 100 ? '🌟 Perfect score!' : '📝 Log data →'}
                                </Link>
                            </div>
                        </div>
                    )}

                    {/* ── Stat Cards (real Firestore data) ── */}
                    <div className="stat-row">
                        <div className="stat-card">
                            <div className="stat-card-icon blue">💧</div>
                            <div className="stat-card-label">Today Water Intake</div>
                            <div className="stat-card-value">
                                {logsLoading
                                    ? <span className="stat-card-unit">—</span>
                                    : todayWater !== null
                                        ? <>{todayWater} <span className="stat-card-unit">glasses</span></>
                                        : <span className="stat-card-unit" style={{ fontSize: 14 }}>Not logged yet</span>
                                }
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-icon green">⚡</div>
                            <div className="stat-card-label">Today Activity</div>
                            <div className="stat-card-value">
                                {logsLoading
                                    ? <span className="stat-card-unit">—</span>
                                    : todayActivity !== null
                                        ? <>{todayActivity} <span className="stat-card-unit">min</span></>
                                        : <span className="stat-card-unit" style={{ fontSize: 14 }}>Not logged yet</span>
                                }
                            </div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-card-icon purple">⚖️</div>
                            <div className="stat-card-label">Latest Weight</div>
                            <div className="stat-card-value">
                                {logsLoading
                                    ? <span className="stat-card-unit">—</span>
                                    : todayWeight !== null
                                        ? <>{todayWeight} <span className="stat-card-unit">kg</span></>
                                        : <span className="stat-card-unit" style={{ fontSize: 14 }}>Not set</span>
                                }
                            </div>
                        </div>
                    </div>

                    {/* ── Mid Row: Daily Streak + Steps Tracking ── */}
                    <div className="mid-row">
                        {/* Daily Streak (already real) */}
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">
                                    <span className="card-title-icon">🔥</span> Daily Streak
                                </div>
                                {currentStreak >= 7 && (
                                    <span style={{ fontSize: 11, background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                                        🏆 {currentStreak >= 30 ? 'Month Master' : currentStreak >= 14 ? 'Two Week Streak' : 'Week Warrior'}!
                                    </span>
                                )}
                            </div>
                            <div className="streak-days" style={{ color: currentStreak > 0 ? '#F59E0B' : undefined }}>
                                {currentStreak}
                            </div>
                            <div className="streak-label">days</div>
                            <div className="streak-cta">{streakLabel(currentStreak)}</div>
                            <div className="streak-mini-row">
                                <div className="streak-mini">
                                    <div className="streak-mini-val">{bestStreak} days</div>
                                    <div className="streak-mini-lbl">🏆 Best Streak</div>
                                </div>
                                <div className="streak-mini">
                                    <div className="streak-mini-val">{totalDays} days</div>
                                    <div className="streak-mini-lbl">📅 Total Days</div>
                                </div>
                            </div>
                            <button
                                className="btn-checkin"
                                onClick={checkIn}
                                disabled={checkedInToday || checkingIn}
                                style={checkedInToday ? { background: '#10B981', cursor: 'default' } : undefined}
                            >
                                {checkingIn ? '⏳ Saving…' : checkedInToday ? '✅ Checked In! Come back tomorrow' : '+ Check In Today'}
                            </button>
                            {checkInError && (
                                <div style={{ marginTop: 8, fontSize: 12, color: '#EF4444', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '6px 10px' }}>
                                    ⚠️ {checkInError}
                                </div>
                            )}
                        </div>

                        {/* Steps Tracking (real Firestore data) */}
                        <div className="card">
                            <div className="card-header">
                                <div className="card-title">
                                    <span className="card-title-icon">👣</span> Steps Tracking
                                </div>
                                <span style={{ fontSize: 11, color: '#9CA3AF' }}>Daily movement goals</span>
                            </div>
                            {logsLoading ? (
                                <div style={{ color: '#9CA3AF', fontSize: 13, padding: '12px 0' }}>Loading…</div>
                            ) : (
                                <>
                                    <div className="steps-big">
                                        {formatSteps(stepsStats.avg)} <span className="steps-unit">avg steps/day</span>
                                    </div>
                                    <div className="steps-cta">
                                        {stepsStats.daysTracked === 0
                                            ? 'Start tracking your steps today!'
                                            : stepsStats.avg >= 10000
                                                ? '🎉 Crushing your step goal!'
                                                : stepsStats.avg >= 7500
                                                    ? 'Almost at 10,000 — keep going!'
                                                    : 'Aim for 10,000 steps daily for best results.'}
                                    </div>
                                    <div className="steps-mini-row">
                                        <div className="steps-mini green">
                                            <div className="steps-mini-val">{formatSteps(stepsStats.total)}</div>
                                            <div className="steps-mini-lbl">Total Steps</div>
                                        </div>
                                        <div className="steps-mini blue">
                                            <div className="steps-mini-val">{stepsStats.daysTracked}</div>
                                            <div className="steps-mini-lbl">Days Tracked</div>
                                        </div>
                                        <div className="steps-mini yellow">
                                            <div className="steps-mini-val">{stepsStats.tenKDays}</div>
                                            <div className="steps-mini-lbl">10k+ Days</div>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* ── Smart Logging Reminder Banner ── */}
                    {!logsLoading && !checkedInToday && (
                        <div className="alert-banner">
                            <span>⚠️</span>
                            Check in now to start your tracking streak and earn achievements!
                        </div>
                    )}
                    {!logsLoading && checkedInToday && loggedCount < 5 && (
                        <div className="alert-banner" style={{ background: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }}>
                            <span>📝</span>
                            You've logged <strong>{loggedCount}/5</strong> health items today.
                            {' '}<Link to="/record" style={{ color: '#D97706', fontWeight: 700 }}>Complete your log →</Link>
                        </div>
                    )}
                    {!logsLoading && checkedInToday && loggedCount === 5 && (
                        <div className="alert-banner" style={{ background: '#ECFDF5', borderColor: '#A7F3D0', color: '#065F46' }}>
                            <span>✅</span>
                            You're on a <strong>{currentStreak}-day streak!</strong> {streakLabel(currentStreak)} All 5 items logged today! 🎉
                        </div>
                    )}

                    {/* ── Diabetes Risk Assessment ── */}
                    <DiabetesRiskCard userId={user?.uid} />

                    {/* ── Bottom Row: Chart + Right Panel ── */}
                    <div className="bottom-row">
                        {/* Weekly Progress Chart (real Firestore data) */}
                        <div className="card chart-card">
                            <div className="chart-title">Weekly Progress</div>
                            <div className="chart-sub">Your hydration, activity, and blood sugar trends (last 7 days)</div>

                            {logsLoading ? (
                                <div style={{ color: '#9CA3AF', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
                                    Loading chart data…
                                </div>
                            ) : noChartData ? (
                                <div style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF' }}>
                                    <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
                                    <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>No chart data yet</div>
                                    <div style={{ fontSize: 12 }}>Start logging daily data to see your trends here.</div>
                                    <Link to="/record" style={{ display: 'inline-block', marginTop: 12, fontSize: 13, fontWeight: 600, color: '#10B981' }}>
                                        Log today's data →
                                    </Link>
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height={220}>
                                    <LineChart data={weeklyData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }}
                                            formatter={(value, name) => value === null ? ['—', name] : [value, name]}
                                        />
                                        <Legend
                                            wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                                            formatter={(value) => ({
                                                activity: 'Activity (min)',
                                                fasting: 'Fasting Glucose (mg/dL)',
                                                postMeal: 'Post-Meal Glucose (mg/dL)',
                                                water: 'Water Intake (glasses)',
                                            }[value] || value)}
                                        />
                                        <Line type="monotone" dataKey="activity"  stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                        <Line type="monotone" dataKey="fasting"   stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                        <Line type="monotone" dataKey="postMeal"  stroke="#EF4444" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                        <Line type="monotone" dataKey="water"     stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        {/* Right col: Achievements + Smart Recommendations */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Achievements */}
                            <div className="card achievements-card">
                                <div className="section-header">
                                    <div className="section-title">🏆 Achievements</div>
                                    <Link to="/achievements" className="view-all">View all →</Link>
                                </div>
                                <div className="progress-row">
                                    <span>Progress</span>
                                    <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{streakAchsEarned} / {STREAK_ACH_TOTAL} earned</span>
                                </div>
                                <div className="progress-bar-wrap">
                                    <div className="progress-bar-fill" style={{ width: `${achProgress}%` }} />
                                </div>
                                {streakAchsEarned === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-state-icon">🏅</div>
                                        <div className="empty-state-text">Check in daily to earn your first achievement!</div>
                                    </div>
                                ) : (
                                    <div className="ach-preview-list">
                                        {currentStreak >= 1  && <div className="ach-pill earned">👣 First Steps</div>}
                                        {currentStreak >= 7  && <div className="ach-pill earned">🔥 Week Warrior</div>}
                                        {currentStreak >= 14 && <div className="ach-pill earned">💪 Two Week Streak</div>}
                                        {currentStreak >= 30 && <div className="ach-pill earned">📅 Month Master</div>}
                                        {currentStreak >= 60 && <div className="ach-pill earned">🛡️ Prevention Hero</div>}
                                        {currentStreak >= 90 && <div className="ach-pill earned">🏆 Health Champion</div>}
                                    </div>
                                )}
                            </div>

                            {/* Smart Recommendations based on today's real data */}
                            <div className="card recommendations-card">
                                <div className="section-title" style={{ marginBottom: 4 }}>💡 Recommendations</div>
                                <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 10 }}>Based on today&apos;s logged data</div>
                                {logsLoading ? (
                                    <div style={{ color: '#9CA3AF', fontSize: 12 }}>Loading…</div>
                                ) : (
                                    recommendations.map((r) => (
                                        <div className="rec-item" key={r.title}>
                                            <span className="rec-icon">{r.icon}</span>
                                            <div>
                                                <div className="rec-title">{r.title}</div>
                                                <div className="rec-desc">{r.desc}</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Today's Log Summary (replaces fake reminders) ── */}
                    <div className="card reminders-card">
                        <div className="section-header">
                            <div className="section-title">📋 Today&apos;s Log Summary</div>
                            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
                                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                            </span>
                        </div>
                        <div className="reminders-grid">
                            {logsLoading ? (
                                <div style={{ gridColumn: '1/-1', color: '#9CA3AF', fontSize: 13, padding: '12px 0' }}>Loading…</div>
                            ) : (
                                loggedItems.map((item) => (
                                    <div
                                        key={item.label}
                                        className={`reminder-item ${item.logged ? 'completed' : 'pending'}`}
                                    >
                                        <div className="reminder-title">{item.label}</div>
                                        <div className={`reminder-status ${item.logged ? 'done' : 'pending'}`}>
                                            {item.logged ? '✅ Logged today' : '⏳ Not logged yet'}
                                        </div>
                                        {!item.logged && (
                                            <Link to="/record" style={{ fontSize: 11, color: '#F97316', fontWeight: 600, textDecoration: 'none', marginTop: 4, display: 'block' }}>
                                                Log now →
                                            </Link>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
