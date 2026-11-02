import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import {
    collection, query, where, orderBy, getDocs, doc, getDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useStreak } from '../hooks/useStreak';
import Sidebar from '../components/Sidebar';
import TopHeader from '../components/TopHeader';
import '../dashboard.css';
import '../report.css';
import logo from '../assets/logo.png';

/* ── Report type → date range presets ───────────────────── */
const REPORT_TYPES = ['Daily Summary', 'Weekly Summary', 'Monthly Summary', 'Custom Range'];

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}
function monthAgo() {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
}

/* ── Stat helpers ────────────────────────────────────────── */
function avg(arr) {
    const valid = arr.filter((v) => v != null && !isNaN(v));
    if (!valid.length) return null;
    return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}

function bsStatus(val, low, high) {
    if (typeof val !== 'number') return 'normal';
    return val >= low && val <= high ? 'normal' : 'high';
}

/* ── Aggregate Firestore docs into report data ───────────── */
function aggregate(docs) {
    if (!docs.length) return null;

    const waterVals  = docs.map((d) => d.foodIntake?.waterIntake).filter(Boolean);
    const actVals    = docs.map((d) => d.physicalActivity?.activityDuration).filter(Boolean);
    const stepVals   = docs.map((d) => d.physicalActivity?.dailySteps).filter(Boolean);
    const fastings   = docs.map((d) => d.bloodSugar?.fastingGlucose).filter(Boolean);
    // Collect post-meal readings from all slot-specific fields (new format) and legacy field
    const postMeals  = docs.map((d) => {
        const bs = d.bloodSugar || {};
        // New format: slot-specific fields
        const slotVals = [bs.afterBreakfast, bs.afterLunch, bs.afterDinner].filter(Boolean);
        if (slotVals.length > 0) {
            return slotVals.reduce((a, b) => a + b, 0) / slotVals.length;
        }
        // Legacy fallback
        return bs.postMealGlucose || null;
    }).filter(Boolean);
    const hba1cList  = [...docs].reverse().map((d) => d.bloodSugar?.hba1c).filter(Boolean);
    const wVals      = docs.map((d) => d.bodyMeasurement?.weight).filter(Boolean);

    const mealsLogged = docs.reduce((sum, d) => {
        const fi = d.foodIntake || {};
        return sum + [fi.breakfast, fi.lunch, fi.dinner, fi.snacks].filter(Boolean).length;
    }, 0);

    const totalSteps = stepVals.reduce((a, b) => a + b, 0);
    const weightChange = wVals.length >= 2
        ? Math.round((wVals[wVals.length - 1] - wVals[0]) * 10) / 10
        : null;

    // Unique activity types logged
    const activityTypes = [...new Set(
        docs.map((d) => d.physicalActivity?.activityType).filter(Boolean)
    )];

    // Blood sugar improvement (first half vs second half)
    let bsImprovement = null;
    if (fastings.length >= 2) {
        const half = Math.ceil(fastings.length / 2);
        const first = avg(fastings.slice(0, half));
        const second = avg(fastings.slice(half));
        if (first && second && first > 0) {
            bsImprovement = Math.round(((first - second) / first) * 100);
        }
    }

    // Meals breakdown
    const breakfasts = docs.filter((d) => d.foodIntake?.breakfast).length;
    const lunches    = docs.filter((d) => d.foodIntake?.lunch).length;
    const dinners    = docs.filter((d) => d.foodIntake?.dinner).length;

    return {
        daysRecorded: docs.length,
        avgWater:     avg(waterVals),
        avgActivity:  avg(actVals),
        totalSteps,
        avgSteps:     avg(stepVals),
        mealsLogged,
        breakfasts, lunches, dinners,
        activityTypes,
        weightChange,
        firstWeight:  wVals[0] ?? null,
        lastWeight:   wVals[wVals.length - 1] ?? null,
        avgFasting:   avg(fastings),
        avgPostMeal:  avg(postMeals),
        latestHba1c:  hba1cList[0] ?? null,
        bsImprovement,
    };
}

/* ── Build personalised recommendations from real data ───── */
function buildRecommendations(data, streak) {
    const recs = [];
    if (!data) return recs;

    if (data.avgWater != null && data.avgWater >= 8) {
        recs.push('Great hydration! You averaged ' + data.avgWater + ' glasses/day — keep it up.');
    } else if (data.avgWater != null) {
        recs.push('Try to increase your daily water intake to 8 glasses (you averaged ' + data.avgWater + ' glasses/day).');
    }

    if (data.avgActivity != null && data.avgActivity >= 30) {
        recs.push('Excellent activity level! You averaged ' + data.avgActivity + ' min/day of exercise.');
    } else if (data.avgActivity != null) {
        recs.push('Aim for at least 30 minutes of activity per day (you averaged ' + data.avgActivity + ' min/day).');
    }

    if (data.avgSteps != null && data.avgSteps >= 10000) {
        recs.push('Step goal achieved! You averaged ' + data.avgSteps.toLocaleString() + ' steps/day.');
    } else if (data.avgSteps != null) {
        recs.push('Work towards 10,000 steps per day — you averaged ' + data.avgSteps.toLocaleString() + ' steps/day.');
    }

    if (data.avgFasting != null && data.avgFasting <= 100) {
        recs.push('Your fasting glucose (' + data.avgFasting + ' mg/dL) is within the normal range — excellent!');
    } else if (data.avgFasting != null) {
        recs.push('Your fasting glucose (' + data.avgFasting + ' mg/dL) is above the normal range. Consider consulting your healthcare provider.');
    }

    if (data.mealsLogged > 0) {
        recs.push('You logged ' + data.mealsLogged + ' meals across ' + data.daysRecorded + ' days — consistent logging helps identify healthy patterns.');
    } else {
        recs.push('Start logging your meals daily to get personalised nutrition insights.');
    }

    if (streak >= 7) {
        recs.push('You\'re on a ' + streak + '-day streak! Consistency is the key to long-term health improvement.');
    } else {
        recs.push('Build a daily check-in habit to earn streak achievements and stay motivated.');
    }

    return recs.slice(0, 5);
}

/* ── Format date for display ─────────────────────────────── */
const formatDate = (d) =>
    d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
    }) : '—';

/* ── Main Component ──────────────────────────────────────── */
export default function Report() {
    const navigate = useNavigate();
    const [user, setUser]             = useState(null);
    const [profile, setProfile]       = useState(null);
    const [reportType, setReportType] = useState('Monthly Summary');
    const [startDate, setStartDate]   = useState(monthAgo());
    const [endDate, setEndDate]       = useState(todayStr());
    const [generating, setGenerating] = useState(false);
    const [reportData, setReportData] = useState(null);   // null = not yet generated
    const [noData, setNoData]         = useState(false);
    const [fetchError, setFetchError] = useState('');

    // Auth guard
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) { navigate('/login'); return; }
            setUser(u);
            try {
                const snap = await getDoc(doc(db, 'users', u.uid));
                if (snap.exists()) setProfile(snap.data());
            } catch { /* ignore */ }
        });
        return () => unsub();
    }, [navigate]);

    // Real streak
    const { current: currentStreak } = useStreak(user?.uid);

    const displayName = profile?.fullName || user?.displayName || user?.email?.split('@')[0] || 'User';

    // Auto-adjust dates when report type changes
    const handleTypeChange = (type) => {
        setReportType(type);
        setReportData(null);
        setNoData(false);
        const t = todayStr();
        if (type === 'Daily Summary')   { setStartDate(t);         setEndDate(t); }
        if (type === 'Weekly Summary')  { setStartDate(daysAgo(6)); setEndDate(t); }
        if (type === 'Monthly Summary') { setStartDate(monthAgo()); setEndDate(t); }
        // Custom Range: keep existing dates
    };

    /* ── Fetch real data from Firestore ── */
    const handleGenerate = useCallback(async () => {
        if (!user || !startDate || !endDate) return;
        setGenerating(true);
        setReportData(null);
        setNoData(false);
        setFetchError('');

        try {
            const logsRef = collection(db, 'users', user.uid, 'dailyLogs');
            const q = query(
                logsRef,
                where('date', '>=', startDate),
                where('date', '<=', endDate),
                orderBy('date', 'asc'),
            );
            const snap = await getDocs(q);
            const docs = snap.docs.map((d) => d.data());

            if (!docs.length) {
                setNoData(true);
            } else {
                setReportData(aggregate(docs));
            }
        } catch (err) {
            if (err.code === 'permission-denied') {
                setFetchError('Permission denied. Please make sure your Firestore rules are published.');
            } else {
                setFetchError('Failed to load data: ' + err.message);
            }
        } finally {
            setGenerating(false);
        }
    }, [user, startDate, endDate]);

    const recs = buildRecommendations(reportData, currentStreak);

    const weightChangeLabel = reportData?.weightChange != null
        ? (reportData.weightChange < 0
            ? `↓ ${Math.abs(reportData.weightChange)} kg`
            : reportData.weightChange > 0
            ? `↑ ${reportData.weightChange} kg`
            : 'Stable')
        : '—';

    return (
        <div className="db-layout">
            <Sidebar />

            <div className="db-main">
                <TopHeader user={user} profile={profile} />

                <div className="db-body">
                    {/* Title */}
                    <div>
                        <div className="db-page-title">📊 Generate Report</div>
                        <div className="db-page-sub">Create a summary of your health progress</div>
                    </div>

                    <div className="report-layout">
                        {/* ── LEFT: Generate Form ── */}
                        <div className="report-form-card">
                            <div className="report-card-header">
                                <div className="report-card-icon">📄</div>
                                <div>
                                    <div className="report-card-title">Generate report</div>
                                    <div className="report-card-sub">Pulls your real recorded health data</div>
                                </div>
                            </div>

                            {/* Report type */}
                            <div className="rec-field-group">
                                <label className="rec-label">Report Type</label>
                                <select
                                    className="rec-input rec-select"
                                    value={reportType}
                                    onChange={(e) => handleTypeChange(e.target.value)}
                                >
                                    {REPORT_TYPES.map((t) => <option key={t}>{t}</option>)}
                                </select>
                                <div className="rec-hint">Selecting a preset auto-fills the date range</div>
                            </div>

                            {/* Date row */}
                            <div className="report-date-row">
                                <div className="rec-field-group">
                                    <label className="rec-label">Start Date</label>
                                    <input
                                        type="date"
                                        className="rec-input"
                                        value={startDate}
                                        max={endDate}
                                        onChange={(e) => { setStartDate(e.target.value); setReportData(null); setNoData(false); }}
                                    />
                                </div>
                                <div className="rec-field-group">
                                    <label className="rec-label">End Date</label>
                                    <input
                                        type="date"
                                        className="rec-input"
                                        value={endDate}
                                        min={startDate}
                                        max={todayStr()}
                                        onChange={(e) => { setEndDate(e.target.value); setReportData(null); setNoData(false); }}
                                    />
                                </div>
                            </div>

                            {/* Generate button */}
                            <button
                                className="btn-primary"
                                onClick={handleGenerate}
                                disabled={generating}
                            >
                                {generating ? <><span className="spinner" /> Generating…</> : '⬇ Generate Report'}
                            </button>

                            {/* Error */}
                            {fetchError && (
                                <div className="error-msg"><span>⚠️</span> {fetchError}</div>
                            )}

                            {/* What's included */}
                            <div className="report-includes">
                                <div className="report-includes-title">What's included in your report?</div>
                                <ul className="report-includes-list">
                                    <li>Weight trends and changes</li>
                                    <li>Activity minutes &amp; daily steps</li>
                                    <li>Meal logging and hydration tracking</li>
                                    <li>Personalised recommendations</li>
                                    <li>Blood sugar trends (fasting &amp; post-meal)</li>
                                    <li>Streak &amp; achievement highlights</li>
                                </ul>
                            </div>
                        </div>

                        {/* ── RIGHT: Report Preview ── */}
                        <div className="report-preview-col">

                            {/* Placeholder */}
                            {!generating && !reportData && !noData && !fetchError && (
                                <div className="report-placeholder">
                                    <div className="report-placeholder-icon">📋</div>
                                    <div className="report-placeholder-title">Your report will appear here</div>
                                    <div className="report-placeholder-sub">
                                        Select a date range and click "Generate Report" to see your real health data.
                                    </div>
                                </div>
                            )}

                            {/* Loading state */}
                            {generating && (
                                <div className="report-placeholder">
                                    <div className="spinner" style={{ margin: '0 auto 16px', width: 32, height: 32, borderWidth: 3, borderColor: 'rgba(16,185,129,.3)', borderTopColor: '#10B981' }} />
                                    <div className="report-placeholder-title">Fetching your health data…</div>
                                </div>
                            )}

                            {/* No data */}
                            {!generating && noData && (
                                <div className="report-placeholder">
                                    <div className="report-placeholder-icon">📭</div>
                                    <div className="report-placeholder-title">No records found</div>
                                    <div className="report-placeholder-sub">
                                        No data was recorded between {formatDate(startDate)} and {formatDate(endDate)}.
                                        Go to <strong>Record Data</strong> to start logging your health metrics.
                                    </div>
                                </div>
                            )}

                            {/* Report */}
                            {!generating && reportData && (
                                <div className="report-preview-card" id="report-print-area">

                                    {/* Header */}
                                    <div className="report-preview-header">
                                        <div className="report-preview-logo">
                                            <img src={logo} alt="InsuleTrack" style={{ width: 20, height: 20, objectFit: 'contain', verticalAlign: 'middle', marginRight: 6, borderRadius: 4 }} />
                                            InsuleTrack
                                        </div>
                                        <div className="report-preview-meta">
                                            <div className="report-preview-type">{reportType}</div>
                                            <div className="report-preview-range">
                                                {formatDate(startDate)} – {formatDate(endDate)}
                                            </div>
                                            <div className="report-preview-user">
                                                Generated for: <strong>{displayName}</strong>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Streak highlight */}
                                    {currentStreak > 0 && (
                                        <div className="report-streak-banner">
                                            🔥 Current Streak: <strong>{currentStreak} {currentStreak === 1 ? 'day' : 'days'}</strong>
                                            {currentStreak >= 7 && <span className="report-streak-badge">🏆 {currentStreak >= 30 ? 'Month Master' : currentStreak >= 14 ? 'Two Week Streak' : 'Week Warrior'}</span>}
                                        </div>
                                    )}

                                    {/* ── Health Summary Stats ── */}
                                    <div className="report-section-title">📈 Health Summary</div>
                                    <div className="report-stats-row">
                                        <div className="report-stat">
                                            <span className="report-stat-icon">💧</span>
                                            <div className="report-stat-val">
                                                {reportData.avgWater != null ? `${reportData.avgWater}` : '—'}
                                            </div>
                                            <div className="report-stat-label">Avg Water (glasses/day)</div>
                                        </div>
                                        <div className="report-stat">
                                            <span className="report-stat-icon">⚡</span>
                                            <div className="report-stat-val">
                                                {reportData.avgActivity != null ? `${reportData.avgActivity} min` : '—'}
                                            </div>
                                            <div className="report-stat-label">Avg Activity/day</div>
                                        </div>
                                        <div className="report-stat">
                                            <span className="report-stat-icon">📅</span>
                                            <div className="report-stat-val">{reportData.daysRecorded}</div>
                                            <div className="report-stat-label">Days Recorded</div>
                                        </div>
                                        <div className="report-stat">
                                            <span className="report-stat-icon">⚖️</span>
                                            <div className="report-stat-val"
                                                style={{ color: reportData.weightChange < 0 ? '#10B981' : reportData.weightChange > 0 ? '#EF4444' : '#374151' }}>
                                                {weightChangeLabel}
                                            </div>
                                            <div className="report-stat-label">Weight Change</div>
                                        </div>
                                    </div>

                                    {/* Steps + Meals */}
                                    <div className="report-stats-row" style={{ marginTop: 10 }}>
                                        <div className="report-stat">
                                            <span className="report-stat-icon">👣</span>
                                            <div className="report-stat-val">
                                                {reportData.avgSteps != null ? `${reportData.avgSteps.toLocaleString()}` : '—'}
                                            </div>
                                            <div className="report-stat-label">Avg Steps/day</div>
                                        </div>
                                        <div className="report-stat">
                                            <span className="report-stat-icon">🍽️</span>
                                            <div className="report-stat-val">{reportData.mealsLogged}</div>
                                            <div className="report-stat-label">Meals Logged</div>
                                        </div>
                                        <div className="report-stat">
                                            <span className="report-stat-icon">🏃</span>
                                            <div className="report-stat-val">
                                                {reportData.activityTypes.length > 0
                                                    ? reportData.activityTypes[0]
                                                    : '—'}
                                            </div>
                                            <div className="report-stat-label">Top Activity</div>
                                        </div>
                                        <div className="report-stat">
                                            <span className="report-stat-icon">⚖️</span>
                                            <div className="report-stat-val">
                                                {reportData.lastWeight != null ? `${reportData.lastWeight} kg` : '—'}
                                            </div>
                                            <div className="report-stat-label">Latest Weight</div>
                                        </div>
                                    </div>

                                    {/* ── Blood Sugar ── */}
                                    <div className="report-section-title" style={{ marginTop: 22 }}>🩸 Blood Sugar Averages</div>
                                    <div className="report-bs-row">
                                        <div className="report-bs-item">
                                            <div className="report-bs-val">
                                                {reportData.avgFasting != null ? reportData.avgFasting : '—'}
                                                {reportData.avgFasting != null && <span> mg/dL</span>}
                                            </div>
                                            <div className="report-bs-label">Avg Fasting</div>
                                            {reportData.avgFasting != null && (
                                                <span className={`bs-badge ${bsStatus(reportData.avgFasting, 70, 100)}`}>
                                                    {bsStatus(reportData.avgFasting, 70, 100) === 'normal' ? 'Normal' : 'Above normal'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="report-bs-item">
                                            <div className="report-bs-val">
                                                {reportData.avgPostMeal != null ? reportData.avgPostMeal : '—'}
                                                {reportData.avgPostMeal != null && <span> mg/dL</span>}
                                            </div>
                                            <div className="report-bs-label">Avg Post-Meal</div>
                                            {reportData.avgPostMeal != null && (
                                                <span className={`bs-badge ${bsStatus(reportData.avgPostMeal, 0, 140)}`}>
                                                    {bsStatus(reportData.avgPostMeal, 0, 140) === 'normal' ? 'Normal' : 'Above normal'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="report-bs-item">
                                            <div className="report-bs-val">
                                                {reportData.latestHba1c != null ? reportData.latestHba1c : '—'}
                                                {reportData.latestHba1c != null && <span>%</span>}
                                            </div>
                                            <div className="report-bs-label">Latest HbA1c</div>
                                            {reportData.latestHba1c != null && (
                                                <span className={`bs-badge ${bsStatus(reportData.latestHba1c, 0, 5.7)}`}>
                                                    {bsStatus(reportData.latestHba1c, 0, 5.7) === 'normal' ? 'Normal' : 'Elevated'}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Blood sugar improvement note */}
                                    {reportData.bsImprovement !== null && (
                                        <div style={{ marginTop: 10, fontSize: 12.5, color: reportData.bsImprovement >= 0 ? '#059669' : '#DC2626', background: reportData.bsImprovement >= 0 ? '#ECFDF5' : '#FEF2F2', padding: '8px 12px', borderRadius: 8 }}>
                                            {reportData.bsImprovement >= 0
                                                ? `✅ Blood sugar improved by ${reportData.bsImprovement}% compared to the start of the period.`
                                                : `⚠️ Blood sugar increased by ${Math.abs(reportData.bsImprovement)}% compared to the start of the period. Consider consulting your doctor.`}
                                        </div>
                                    )}

                                    {/* ── Meal Breakdown ── */}
                                    {reportData.mealsLogged > 0 && (
                                        <>
                                            <div className="report-section-title" style={{ marginTop: 22 }}>🍽️ Meal Logging Breakdown</div>
                                            <div className="report-stats-row" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                                                <div className="report-stat">
                                                    <span className="report-stat-icon">🌅</span>
                                                    <div className="report-stat-val">{reportData.breakfasts}</div>
                                                    <div className="report-stat-label">Breakfasts</div>
                                                </div>
                                                <div className="report-stat">
                                                    <span className="report-stat-icon">☀️</span>
                                                    <div className="report-stat-val">{reportData.lunches}</div>
                                                    <div className="report-stat-label">Lunches</div>
                                                </div>
                                                <div className="report-stat">
                                                    <span className="report-stat-icon">🌙</span>
                                                    <div className="report-stat-val">{reportData.dinners}</div>
                                                    <div className="report-stat-label">Dinners</div>
                                                </div>
                                            </div>
                                        </>
                                    )}

                                    {/* ── Personalised Recommendations ── */}
                                    <div className="report-section-title" style={{ marginTop: 22 }}>💡 Personalised Recommendations</div>
                                    <ul className="report-rec-list">
                                        {recs.map((r, i) => <li key={i}>{r}</li>)}
                                    </ul>

                                    {/* Print button */}
                                    <button
                                        className="btn-primary"
                                        style={{ marginTop: 24 }}
                                        onClick={() => window.print()}
                                    >
                                        🖨️ Print / Save as PDF
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
