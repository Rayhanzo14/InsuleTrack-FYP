import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import {
    collection, query, where, orderBy, getDocs,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import Sidebar from '../components/Sidebar';
import TopHeader from '../components/TopHeader';
import '../dashboard.css';
import '../progress.css';
import {
    LineChart, Line, BarChart, Bar, ComposedChart,
    XAxis, YAxis, CartesianGrid, Tooltip,
    Legend, ResponsiveContainer, ReferenceLine,
    PieChart, Pie, Cell,
} from 'recharts';

const RANGES = ['Today', '7 days', '30 days'];

/* ── Helpers ────────────────────────────────────────────── */
function getStartDate(range) {
    // Use local date (not UTC) so users in UTC+8 timezones see the correct day
    const now = new Date();
    const localToday = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('-');

    if (range === 'Today') return localToday;

    const d = new Date();
    if (range === '7 days') {
        d.setDate(d.getDate() - 6);
    } else {
        d.setDate(d.getDate() - 29);
    }
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}

function avg(arr) {
    const valid = arr.filter((v) => v != null && !isNaN(v));
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10;
}

function fmt(dateStr) {
    // "2026-03-15" → "Mar 15"
    const [, m, day] = dateStr.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[parseInt(m, 10) - 1]} ${parseInt(day, 10)}`;
}

/* ── Aggregate raw Firestore docs into chart data ───────── */
function aggregate(docs) {
    if (!docs.length) return null;

    // All 8 test-time glucose readings per day
    const bloodSugar = docs.map((d) => ({
        date:            fmt(d.date),
        // Pre-meal / fasting group
        fasting:         d.bloodSugar?.fastingGlucose    ?? null,
        beforeBreakfast: d.bloodSugar?.beforeBreakfast   ?? null,
        beforeLunch:     d.bloodSugar?.beforeLunch        ?? null,
        beforeDinner:    d.bloodSugar?.beforeDinner       ?? null,
        // Post-meal group
        afterBreakfast:  d.bloodSugar?.afterBreakfast    ?? null,
        afterLunch:      d.bloodSugar?.afterLunch         ?? null,
        afterDinner:     d.bloodSugar?.afterDinner        ?? null,
        // Other
        bedtime:         d.bloodSugar?.bedtimeGlucose    ?? null,
        // Note: postMealGlucose (legacy) is intentionally excluded from the chart
        //       since it duplicates afterBreakfast/afterLunch/afterDinner readings.
    }));

    const weight = docs
        .filter((d) => d.bodyMeasurement?.weight != null)
        .map((d) => ({
            date: fmt(d.date),
            weight: d.bodyMeasurement.weight,
        }));

    const activity = docs.map((d) => ({
        week: fmt(d.date),
        activity: d.physicalActivity?.activityDuration ?? 0,
        water: d.foodIntake?.waterIntake ?? 0,
    }));

    // metrics
    const waterVals = docs.map((d) => d.foodIntake?.waterIntake).filter(Boolean);
    const avgWater = avg(waterVals) ?? 0;

    const mealsLogged = docs.reduce((sum, d) => {
        const fi = d.foodIntake || {};
        return sum + [fi.breakfast, fi.lunch, fi.dinner, fi.snacks].filter(Boolean).length;
    }, 0);

    const daysRecorded = docs.length;

    // improvement: compare avg fasting of first half vs second half
    const fastingVals = docs.map((d) => d.bloodSugar?.fastingGlucose).filter(Boolean);
    let improvement = 0;
    if (fastingVals.length >= 2) {
        const half = Math.ceil(fastingVals.length / 2);
        const firstHalfAvg = avg(fastingVals.slice(0, half));
        const secondHalfAvg = avg(fastingVals.slice(half));
        if (firstHalfAvg && secondHalfAvg && firstHalfAvg > 0) {
            improvement = Math.round(((firstHalfAvg - secondHalfAvg) / firstHalfAvg) * 100);
        }
    }

    // blood sugar summary — use all slot values across all days
    const ALL_SLOT_KEYS = ['fastingGlucose','beforeBreakfast','afterBreakfast','beforeLunch','afterLunch','beforeDinner','afterDinner','bedtimeGlucose','postMealGlucose'];
    const allReadings = docs.flatMap((d) =>
        ALL_SLOT_KEYS.map((k) => d.bloodSugar?.[k]).filter((v) => v != null)
    );
    const fastings  = docs.map((d) => d.bloodSugar?.fastingGlucose).filter((v) => v != null);
    const postMeals = docs.flatMap((d) => [
        d.bloodSugar?.afterBreakfast, d.bloodSugar?.afterLunch,
        d.bloodSugar?.afterDinner,    d.bloodSugar?.postMealGlucose,
    ]).filter((v) => v != null);
    const hba1cVals = [...docs].reverse().map((d) => d.bloodSugar?.hba1c).filter(Boolean);
    const bsSummary = {
        avgAll:      avg(allReadings)  ?? '—',
        avgFasting:  avg(fastings)     ?? '—',
        avgPostMeal: avg(postMeals)    ?? '—',
        hba1c:       hba1cVals[0]     ?? '—',
        totalReadings: allReadings.length,
        maxReading: allReadings.length ? Math.max(...allReadings) : '—',
        minReading: allReadings.length ? Math.min(...allReadings) : '—',
    };

    // weight change
    const wVals = docs.map((d) => d.bodyMeasurement?.weight).filter(Boolean);
    const weightChange = wVals.length >= 2
        ? Math.round((wVals[wVals.length - 1] - wVals[0]) * 10) / 10
        : 0;

    // ── Meal logging consistency ─────────────────────────────
    const total = docs.length;
    const mealConsistency = [
        {
            label: 'Breakfast',
            emoji: '🌅',
            logged: docs.filter((d) => d.foodIntake?.breakfast).length,
            total,
            color: '#F59E0B',
            bg: '#FFFBEB',
        },
        {
            label: 'Lunch',
            emoji: '☀️',
            logged: docs.filter((d) => d.foodIntake?.lunch).length,
            total,
            color: '#10B981',
            bg: '#ECFDF5',
        },
        {
            label: 'Dinner',
            emoji: '🌙',
            logged: docs.filter((d) => d.foodIntake?.dinner).length,
            total,
            color: '#6366F1',
            bg: '#EEF2FF',
        },
        {
            label: 'Snacks',
            emoji: '🍎',
            logged: docs.filter((d) => d.foodIntake?.snacks).length,
            total,
            color: '#EC4899',
            bg: '#FDF2F8',
        },
        {
            label: 'Water Goal (≥8 glasses)',
            emoji: '💧',
            logged: docs.filter((d) => (d.foodIntake?.waterIntake ?? 0) >= 8).length,
            total,
            color: '#3B82F6',
            bg: '#EFF6FF',
        },
    ];

    // ── Meal heatmap: date → count of meals logged
    const mealHeatmap = {};
    docs.forEach((d) => {
        if (!d.date) return;
        const fi = d.foodIntake || {};
        mealHeatmap[d.date] = [fi.breakfast, fi.lunch, fi.dinner, fi.snacks].filter(Boolean).length;
    });

    // ── Meal distribution donut data
    const mealDistribution = [
        { name: 'Breakfast', value: docs.filter((d) => d.foodIntake?.breakfast).length, color: '#F59E0B' },
        { name: 'Lunch',     value: docs.filter((d) => d.foodIntake?.lunch).length,      color: '#10B981' },
        { name: 'Dinner',    value: docs.filter((d) => d.foodIntake?.dinner).length,     color: '#6366F1' },
        { name: 'Snacks',    value: docs.filter((d) => d.foodIntake?.snacks).length,     color: '#EC4899' },
    ];

    // ── Meal vs Glucose correlation ─────────────────────────────
    // Per-meal carbs + matched post-meal glucose (3 pairs)
    const mealGlucose = docs.map((d) => {
        const fi  = d.foodIntake || {};
        const ni  = fi.nutritionInfo || {};
        const bs  = d.bloodSugar   || {};
        const mealNames = [];

        const getCarbs = (slot) => {
            const val = ni[slot]?.carbs ?? null;
            if (ni[slot]?.foodName) mealNames.push(ni[slot].foodName);
            return val !== null ? Math.round(val * 10) / 10 : null;
        };

        const breakfastCarbs = getCarbs('breakfast');
        const lunchCarbs     = getCarbs('lunch');
        const dinnerCarbs    = getCarbs('dinner');
        const totalCarbs     = [breakfastCarbs, lunchCarbs, dinnerCarbs]
            .filter((v) => v !== null)
            .reduce((a, b) => a + b, 0) || null;
        const hasNutrition   = totalCarbs !== null;

        return {
            date:            fmt(d.date),
            meals:           [fi.breakfast, fi.lunch, fi.dinner, fi.snacks].filter(Boolean).length,
            // Per-meal carbs (for grouped bars)
            breakfastCarbs,
            lunchCarbs,
            dinnerCarbs,
            carbs: hasNutrition ? Math.round(totalCarbs * 10) / 10 : null,
            // Per-meal post-meal glucose (3 matched lines)
            afterBreakfast:  bs.afterBreakfast  ?? null,
            afterLunch:      bs.afterLunch       ?? null,
            afterDinner:     bs.afterDinner      ?? null,
            // Legacy fallback
            postMeal:        bs.postMealGlucose  ?? null,
            fasting:         bs.fastingGlucose   ?? null,
            sugar:           ni.breakfast?.sugar ?? ni.lunch?.sugar ?? ni.dinner?.sugar ?? null,
            calories:        Object.values(ni).reduce((s, v) => s + (v?.calories ?? 0), 0) || null,
            foodNames:       mealNames,
            hasNutrition,
        };
    });

    const hasAnyNutrition = mealGlucose.some((d) => d.hasNutrition);
    // Chart shows if any post-meal reading exists (any of 3 slots or legacy)
    const hasAnyPostMeal  = mealGlucose.some((d) =>
        d.afterBreakfast !== null || d.afterLunch !== null || d.afterDinner !== null || d.postMeal !== null
    );

    // Insight: carb-glucose pairs using all post-meal readings
    const highMealDays       = mealGlucose.filter((d) => d.meals >= 3 && (d.afterBreakfast ?? d.afterLunch ?? d.afterDinner ?? d.postMeal) !== null);
    const lowMealDays        = mealGlucose.filter((d) => d.meals <= 1 && (d.afterBreakfast ?? d.afterLunch ?? d.afterDinner ?? d.postMeal) !== null);
    const getFirstPostMeal   = (d) => d.afterBreakfast ?? d.afterLunch ?? d.afterDinner ?? d.postMeal;
    const avgGlucoseHighMeal = avg(highMealDays.map(getFirstPostMeal).filter((v) => v !== null));
    const avgGlucoseLowMeal  = avg(lowMealDays.map(getFirstPostMeal).filter((v) => v !== null));

    const carbGlucoseDays    = mealGlucose.filter((d) => d.carbs !== null && getFirstPostMeal(d) !== null);
    const highCarbDays       = carbGlucoseDays.filter((d) => d.carbs >= 50);
    const lowCarbDays        = carbGlucoseDays.filter((d) => d.carbs < 50);
    const avgGlucoseHighCarb = avg(highCarbDays.map((d) => getFirstPostMeal(d)));
    const avgGlucoseLowCarb  = avg(lowCarbDays.map((d)  => getFirstPostMeal(d)));
    const avgDailyCarbs      = avg(carbGlucoseDays.map((d) => d.carbs));

    const mealGlucoseInsight = {
        highMealDays: highMealDays.length,
        lowMealDays:  lowMealDays.length,
        avgGlucoseHighMeal,
        avgGlucoseLowMeal,
        hasPairedData:        highMealDays.length > 0 && lowMealDays.length > 0,
        hasAnyNutrition,
        hasAnyPostMeal,
        avgGlucoseHighCarb,
        avgGlucoseLowCarb,
        avgDailyCarbs,
        hasNutritionInsight:  highCarbDays.length > 0 && lowCarbDays.length > 0,
    };

    return { bloodSugar, weight, activity, metrics: { avgWater, mealsLogged, daysRecorded, improvement }, bsSummary, weightChange, mealConsistency, mealHeatmap, mealDistribution, mealGlucose, mealGlucoseInsight };
}

/* ── Custom Tooltip ─────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="chart-tooltip">
            <div className="tooltip-label">{label}</div>
            {payload.map((p) => (
                <div key={p.name} style={{ color: p.color, fontSize: 12 }}>
                    {p.name}: <strong>{p.value}</strong>
                </div>
            ))}
        </div>
    );
};

/* ── Heatmap colour helper ───────────────────────────────── */
function heatColor(count) {
    if (count === undefined) return '#F3F4F6';
    if (count === 0) return '#E5E7EB';
    if (count === 1) return '#D1FAE5';
    if (count === 2) return '#6EE7B7';
    if (count === 3) return '#34D399';
    return '#10B981'; // 4 meals
}

/* ── Main Component ─────────────────────────────────────── */
export default function Progress() {
    const navigate = useNavigate();

    // Last 35 days for heatmap display (5-week calendar)
    const heatmapDays = React.useMemo(() => {
        const days = [];
        for (let i = 34; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = [
                d.getFullYear(),
                String(d.getMonth() + 1).padStart(2, '0'),
                String(d.getDate()).padStart(2, '0'),
            ].join('-');
            days.push({
                dateStr,
                label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                dow: d.getDay(), // 0 = Sun
            });
        }
        return days;
    }, []);
    const [user, setUser] = useState(null);
    const [range, setRange] = useState('30 days');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) { navigate('/login'); return; }
            setUser(u);
        });
        return () => unsub();
    }, [navigate]);

    const fetchLogs = useCallback(async (uid, selectedRange) => {
        setLoading(true);
        try {
            const startDate = getStartDate(selectedRange);
            const logsRef = collection(db, 'users', uid, 'dailyLogs');
            const q = query(logsRef, where('date', '>=', startDate), orderBy('date', 'asc'));
            const snap = await getDocs(q);
            const docs = snap.docs.map((d) => d.data());
            setData(aggregate(docs));
        } catch (err) {
            console.error('Failed to fetch logs:', err);
            setData(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (user) fetchLogs(user.uid, range);
    }, [user, range, fetchLogs]);

    const bsStatus = (val, low, high) => {
        if (typeof val !== 'number') return 'normal';
        return val >= low && val <= high ? 'normal' : val < low ? 'low' : 'high';
    };

    /* ── Empty / Loading states ─────────────────────────── */
    // Consider the page empty only when ALL metric arrays are empty (not just bloodSugar)
    const isEmpty = !data || (
        data.bloodSugar.length === 0 &&
        data.weight.length === 0 &&
        data.activity.length === 0
    );

    return (
        <div className="db-layout">
            <Sidebar />

            <div className="db-main">
                <TopHeader user={user} />

                <div className="db-body">
                    {/* Title + range filters */}
                    <div className="prog-title-row">
                        <div>
                            <div className="db-page-title">Progress overview</div>
                            <div className="db-page-sub">Track your health trends and improvements over time</div>
                        </div>
                        <div className="range-tabs">
                            <span className="range-tab-icon">📅</span>
                            <span style={{ fontSize: 12, color: '#6B7280', marginRight: 8 }}>Date Range</span>
                            {RANGES.map((r) => (
                                <button
                                    key={r}
                                    className={`range-tab${range === r ? ' active' : ''}`}
                                    onClick={() => setRange(r)}
                                >
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Loading */}
                    {loading && (
                        <div style={{ textAlign: 'center', padding: '60px 0', color: '#9CA3AF', fontSize: 15 }}>
                            <div className="spinner" style={{ margin: '0 auto 16px', width: 32, height: 32, borderWidth: 3 }} />
                            Loading your health data…
                        </div>
                    )}

                    {/* Empty state */}
                    {!loading && isEmpty && (
                        <div style={{
                            textAlign: 'center', padding: '60px 20px',
                            background: '#fff', borderRadius: 14,
                            boxShadow: '0 2px 8px rgba(0,0,0,.05)'
                        }}>
                            <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>
                                No data recorded yet
                            </div>
                            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
                                Start recording your daily health data to see your trends here.
                            </div>
                            <button
                                className="btn-primary"
                                style={{ maxWidth: 200, margin: '0 auto', padding: '10px 24px', fontSize: 13 }}
                                onClick={() => navigate('/record')}
                            >
                                📝 Record Data
                            </button>
                        </div>
                    )}

                    {/* Charts */}
                    {!loading && !isEmpty && (
                        <div className="prog-layout">
                            {/* LEFT column */}
                            <div className="prog-left">

                                {/* Blood Sugar Trends */}
                                <div className="card chart-card">
                                    <div className="prog-card-header">
                                        <span className="prog-card-icon blood">🩸</span>
                                        <div>
                                            <div className="chart-title">Blood Sugar Trends</div>
                                            <div className="chart-sub">All {data.bsSummary.totalReadings} glucose readings across all 8 test times</div>
                                        </div>
                                    </div>
                                    <ResponsiveContainer width="100%" height={240}>
                                        <LineChart data={data.bloodSugar} margin={{ top: 5, right: 14, left: -22, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                            <YAxis domain={[50, 'auto']} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                            <Tooltip
                                                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,.1)', fontSize: 12 }}
                                                formatter={(value, name) => {
                                                    const labels = {
                                                        fasting:         'Fasting',
                                                        beforeBreakfast: 'Before Breakfast',
                                                        afterBreakfast:  'After Breakfast (2h)',
                                                        beforeLunch:     'Before Lunch',
                                                        afterLunch:      'After Lunch (2h)',
                                                        beforeDinner:    'Before Dinner',
                                                        afterDinner:     'After Dinner (2h)',
                                                        bedtime:         'Bedtime',
                                                    };
                                                    return value != null ? [`${value} mg/dL`, labels[name] ?? name] : null;
                                                }}
                                            />
                                            {/* Threshold reference lines */}
                                            <ReferenceLine y={100} stroke="#10B981" strokeDasharray="4 2" strokeWidth={1}
                                                label={{ value: 'Fasting Max 100', position: 'right', fontSize: 9, fill: '#10B981' }} />
                                            <ReferenceLine y={140} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1}
                                                label={{ value: 'Post-Meal Max 140', position: 'right', fontSize: 9, fill: '#F59E0B' }} />
                                            <ReferenceLine y={180} stroke="#EF4444" strokeDasharray="4 2" strokeWidth={1}
                                                label={{ value: 'High 180', position: 'right', fontSize: 9, fill: '#EF4444' }} />
                                            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                                                formatter={(v) => ({
                                                    fasting:         '🔵 Fasting',
                                                    beforeBreakfast: '🔵 Before Breakfast',
                                                    afterBreakfast:  '🔴 After Breakfast',
                                                    beforeLunch:     '🟢 Before Lunch',
                                                    afterLunch:      '🟠 After Lunch',
                                                    beforeDinner:    '🟣 Before Dinner',
                                                    afterDinner:     '🟡 After Dinner',
                                                    bedtime:         '⚫ Bedtime',
                                                }[v] ?? v)}
                                            />
                                            {/* ─ Pre-meal / fasting: blue family */}
                                            <Line type="monotone" dataKey="fasting"         stroke="#1D4ED8" strokeWidth={2}   dot={{ r: 3 }} connectNulls />
                                            <Line type="monotone" dataKey="beforeBreakfast" stroke="#60A5FA" strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls strokeDasharray="5 2" />
                                            <Line type="monotone" dataKey="beforeLunch"     stroke="#10B981" strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls strokeDasharray="5 2" />
                                            <Line type="monotone" dataKey="beforeDinner"    stroke="#059669" strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls strokeDasharray="5 2" />
                                            {/* ─ Post-meal: red/amber family */}
                                            <Line type="monotone" dataKey="afterBreakfast"  stroke="#EF4444" strokeWidth={2}   dot={{ r: 3 }} connectNulls />
                                            <Line type="monotone" dataKey="afterLunch"      stroke="#F97316" strokeWidth={2}   dot={{ r: 3 }} connectNulls />
                                            <Line type="monotone" dataKey="afterDinner"     stroke="#F59E0B" strokeWidth={2}   dot={{ r: 3 }} connectNulls />
                                            {/* ─ Other */}
                                            <Line type="monotone" dataKey="bedtime"         stroke="#8B5CF6" strokeWidth={1.5} dot={{ r: 2.5 }} connectNulls strokeDasharray="3 3" />
                                        </LineChart>
                                    </ResponsiveContainer>

                                    {/* Blood Sugar Summary */}
                                    <div className="bs-summary-row">
                                        <div className="bs-summary-item">
                                            <div className="bs-summary-val">
                                                {data.bsSummary.avgFasting} <span>mg/dL</span>
                                            </div>
                                            <div className="bs-summary-label">Avg Fasting</div>
                                            <div className={`bs-badge ${bsStatus(data.bsSummary.avgFasting, 70, 100)}`}>
                                                {bsStatus(data.bsSummary.avgFasting, 70, 100) === 'normal' ? 'Normal range' : 'Out of range'}
                                            </div>
                                        </div>
                                        <div className="bs-summary-item">
                                            <div className="bs-summary-val">
                                                {data.bsSummary.avgPostMeal} <span>mg/dL</span>
                                            </div>
                                            <div className="bs-summary-label">Avg Post-Meal</div>
                                            <div className={`bs-badge ${bsStatus(data.bsSummary.avgPostMeal, 0, 140)}`}>
                                                {bsStatus(data.bsSummary.avgPostMeal, 0, 140) === 'normal' ? 'Normal range' : 'Out of range'}
                                            </div>
                                        </div>
                                        <div className="bs-summary-item">
                                            <div className="bs-summary-val">
                                                {data.bsSummary.hba1c}<span>%</span>
                                            </div>
                                            <div className="bs-summary-label">Latest HbA1c</div>
                                            <div className={`bs-badge ${bsStatus(data.bsSummary.hba1c, 0, 5.7)}`}>
                                                {bsStatus(data.bsSummary.hba1c, 0, 5.7) === 'normal' ? 'Normal range' : 'Elevated'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Daily range summary row */}
                                    {data.bsSummary.totalReadings > 0 && (
                                        <div style={{ display:'flex', gap:10, marginTop:10, flexWrap:'wrap' }}>
                                            <div style={{ flex:1, minWidth:90, background:'#F0FDF4', borderRadius:8, padding:'8px 12px' }}>
                                                <div style={{ fontSize:16, fontWeight:700, color:'#10B981' }}>{data.bsSummary.minReading} <span style={{fontSize:11,fontWeight:400}}>mg/dL</span></div>
                                                <div style={{ fontSize:11, color:'#6B7280' }}>Lowest reading</div>
                                            </div>
                                            <div style={{ flex:1, minWidth:90, background:'#FEF2F2', borderRadius:8, padding:'8px 12px' }}>
                                                <div style={{ fontSize:16, fontWeight:700, color:'#EF4444' }}>{data.bsSummary.maxReading} <span style={{fontSize:11,fontWeight:400}}>mg/dL</span></div>
                                                <div style={{ fontSize:11, color:'#6B7280' }}>Highest reading</div>
                                            </div>
                                            <div style={{ flex:1, minWidth:90, background:'#EEF2FF', borderRadius:8, padding:'8px 12px' }}>
                                                <div style={{ fontSize:16, fontWeight:700, color:'#6366F1' }}>{data.bsSummary.avgAll} <span style={{fontSize:11,fontWeight:400}}>mg/dL</span></div>
                                                <div style={{ fontSize:11, color:'#6B7280' }}>Overall avg ({data.bsSummary.totalReadings} readings)</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="bs-insight">
                                        {typeof data.bsSummary.avgFasting === 'number' && data.bsSummary.avgFasting <= 100
                                            ? '✅ Your blood sugar levels are showing positive trends. Keep maintaining your healthy lifestyle!'
                                            : '⚠️ Some readings are above the normal range. Consider consulting your healthcare provider.'}
                                    </div>
                                </div>

                                {/* Weight Trend */}
                                {data.weight.length > 0 && (
                                    <div className="card chart-card">
                                        <div className="prog-card-header">
                                            <span className="prog-card-icon body">⚖️</span>
                                            <div>
                                                <div className="chart-title">Weight Trend</div>
                                                <div className="chart-sub">Track your weight changes over time</div>
                                            </div>
                                        </div>
                                        <ResponsiveContainer width="100%" height={180}>
                                            <LineChart data={data.weight} margin={{ top: 5, right: 10, left: -22, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                                <Tooltip content={<CustomTooltip />} />
                                                <Line type="monotone" dataKey="weight" stroke="#8B5CF6" strokeWidth={2.5} dot={{ r: 4, fill: '#8B5CF6' }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                        <div className="weight-insight">
                                            {data.weightChange < 0 ? (
                                                <>⬇️ Your weight is down <strong>{Math.abs(data.weightChange)} kg</strong> over the selected period. Great progress!</>
                                            ) : data.weightChange === 0 ? (
                                                <>⚖️ Your weight is stable over the selected period.</>
                                            ) : (
                                                <>⬆️ Your weight is up <strong>{data.weightChange} kg</strong> over the selected period. Consider adjusting diet and activity.</>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Activity & Hydration */}
                                <div className="card chart-card">
                                    <div className="prog-card-header">
                                        <span className="prog-card-icon activity">⚡</span>
                                        <div>
                                            <div className="chart-title">Activity &amp; Hydration</div>
                                            <div className="chart-sub">Daily activity minutes and water intake</div>
                                        </div>
                                    </div>
                                    <ResponsiveContainer width="100%" height={180}>
                                        <BarChart data={data.activity} margin={{ top: 5, right: 10, left: -22, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                            <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                                                formatter={(v) => v === 'activity' ? 'Activity (min)' : 'Water Intake (glasses)'} />
                                            <Bar dataKey="activity" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="water" fill="#10B981" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                    <div className="act-insight">
                                        📊 <strong>Activity Summary:</strong> You averaged <strong>{data.metrics.avgWater}</strong> glasses of water per day.
                                        Try to increase both daily activity (45 min target) and water intake (8 glasses target).
                                    </div>
                                </div>

                                {/* ── Meal vs Glucose Relationship ── */}
                                <div className="card chart-card">
                                    <div className="prog-card-header" style={{ marginBottom: 12 }}>
                                        <span className="prog-card-icon" style={{ background: '#FEF2F2' }}>🍽️🩸</span>
                                        <div>
                                            <div className="chart-title">Meal Intake vs Post-Meal Glucose</div>
                                            <div className="chart-sub">
                                                {data.mealGlucoseInsight.hasAnyNutrition
                                                    ? 'Per-meal carbs (g) matched to glucose after each meal'
                                                    : 'Number of meals logged vs post-meal glucose readings'}
                                            </div>
                                        </div>
                                    </div>

                                    {data.mealGlucoseInsight.hasAnyNutrition && (
                                        <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#EEF2FF', borderRadius:20, padding:'4px 12px', fontSize:11, fontWeight:600, color:'#6366F1', marginBottom:12 }}>
                                            ✨ Using real food nutrition data (carbs, sugar, calories)
                                        </div>
                                    )}

                                    {data.mealGlucoseInsight.hasAnyPostMeal ? (
                                        <>
                                            {/* Per-meal colour legend */}
                                            <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:8, fontSize:11, color:'#6B7280' }}>
                                                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:12, height:12, borderRadius:2, background:'#F59E0B', display:'inline-block' }}/> Breakfast carbs (g)</span>
                                                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:12, height:12, borderRadius:2, background:'#10B981', display:'inline-block' }}/> Lunch carbs (g)</span>
                                                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:12, height:12, borderRadius:2, background:'#6366F1', display:'inline-block' }}/> Dinner carbs (g)</span>
                                                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:2, background:'#EF4444', display:'inline-block' }}/>● After Breakfast</span>
                                                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:2, background:'#F97316', display:'inline-block' }}/>● After Lunch</span>
                                                <span style={{ display:'flex', alignItems:'center', gap:4 }}><span style={{ width:14, height:2, background:'#8B5CF6', display:'inline-block' }}/>● After Dinner</span>
                                            </div>

                                            <ResponsiveContainer width="100%" height={220}>
                                                <ComposedChart data={data.mealGlucose} margin={{ top: 5, right: 52, left: -22, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                                    <YAxis
                                                        yAxisId="left"
                                                        orientation="left"
                                                        domain={data.mealGlucoseInsight.hasAnyNutrition ? [0, 'auto'] : [0, 4]}
                                                        ticks={data.mealGlucoseInsight.hasAnyNutrition ? undefined : [0,1,2,3,4]}
                                                        tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
                                                    />
                                                    <YAxis yAxisId="glucose" orientation="right" domain={[60,'auto']} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                                    <Tooltip
                                                        content={({ active, payload, label }) => {
                                                            if (!active || !payload?.length) return null;
                                                            const d = data.mealGlucose.find((x) => x.date === label);
                                                            return (
                                                                <div style={{ background:'#fff', borderRadius:8, padding:'10px 14px', boxShadow:'0 4px 12px rgba(0,0,0,.12)', fontSize:12, minWidth:180 }}>
                                                                    <div style={{ fontWeight:700, marginBottom:6, color:'#1F2937' }}>{label}</div>
                                                                    {d?.foodNames?.length > 0 && <div style={{ color:'#6B7280', fontSize:11, marginBottom:5 }}>🍽️ {d.foodNames.join(', ')}</div>}
                                                                    {d?.breakfastCarbs != null && <div style={{ color:'#F59E0B' }}>🌅 Breakfast carbs: {d.breakfastCarbs}g</div>}
                                                                    {d?.lunchCarbs     != null && <div style={{ color:'#10B981' }}>☀️ Lunch carbs: {d.lunchCarbs}g</div>}
                                                                    {d?.dinnerCarbs    != null && <div style={{ color:'#6366F1' }}>🌙 Dinner carbs: {d.dinnerCarbs}g</div>}
                                                                    {!d?.hasNutrition && d?.meals > 0 && <div style={{ color:'#6B7280' }}>🍽️ Meals logged: {d.meals}</div>}
                                                                    <div style={{ height:1, background:'#F3F4F6', margin:'6px 0' }} />
                                                                    {d?.afterBreakfast != null && <div style={{ color:'#EF4444' }}>🩸 After Breakfast: {d.afterBreakfast} mg/dL</div>}
                                                                    {d?.afterLunch     != null && <div style={{ color:'#F97316' }}>🩸 After Lunch: {d.afterLunch} mg/dL</div>}
                                                                    {d?.afterDinner    != null && <div style={{ color:'#8B5CF6' }}>🩸 After Dinner: {d.afterDinner} mg/dL</div>}
                                                                    {d?.postMeal != null && !d?.afterBreakfast && !d?.afterLunch && !d?.afterDinner && <div style={{ color:'#D97706' }}>🩸 Post-Meal: {d.postMeal} mg/dL</div>}
                                                                    {d?.calories != null && <div style={{ color:'#F59E0B', fontSize:11, marginTop:4 }}>🔥 Total: {d.calories} kcal</div>}
                                                                </div>
                                                            );
                                                        }}
                                                    />
                                                    <ReferenceLine yAxisId="glucose" y={140} stroke="#F59E0B" strokeDasharray="4 2" strokeWidth={1}
                                                        label={{ value: 'Normal Max 140', position: 'right', fontSize: 9, fill: '#F59E0B' }} />
                                                    <ReferenceLine yAxisId="glucose" y={180} stroke="#EF4444" strokeDasharray="4 2" strokeWidth={1}
                                                        label={{ value: 'High 180', position: 'right', fontSize: 9, fill: '#EF4444' }} />
                                                    {/* Stacked carb bars: breakfast (amber) + lunch (green) + dinner (indigo) */}
                                                    {data.mealGlucoseInsight.hasAnyNutrition ? (
                                                        <>
                                                            <Bar yAxisId="left" dataKey="breakfastCarbs" name="Breakfast Carbs" fill="#F59E0B" fillOpacity={0.8} radius={[0,0,0,0]} stackId="carbs" />
                                                            <Bar yAxisId="left" dataKey="lunchCarbs"     name="Lunch Carbs"     fill="#10B981" fillOpacity={0.8} radius={[0,0,0,0]} stackId="carbs" />
                                                            <Bar yAxisId="left" dataKey="dinnerCarbs"    name="Dinner Carbs"    fill="#6366F1" fillOpacity={0.8} radius={[3,3,0,0]} stackId="carbs" />
                                                        </>
                                                    ) : (
                                                        <Bar yAxisId="left" dataKey="meals" name="Meals Logged" fill="#6366F1" fillOpacity={0.55} radius={[3,3,0,0]} />
                                                    )}
                                                    {/* 3 matched post-meal glucose lines */}
                                                    <Line yAxisId="glucose" type="monotone" dataKey="afterBreakfast" name="After Breakfast" stroke="#EF4444" strokeWidth={2}   dot={{ r: 3, fill:'#EF4444' }} connectNulls />
                                                    <Line yAxisId="glucose" type="monotone" dataKey="afterLunch"     name="After Lunch"     stroke="#F97316" strokeWidth={2}   dot={{ r: 3, fill:'#F97316' }} connectNulls />
                                                    <Line yAxisId="glucose" type="monotone" dataKey="afterDinner"    name="After Dinner"    stroke="#8B5CF6" strokeWidth={2}   dot={{ r: 3, fill:'#8B5CF6' }} connectNulls />
                                                    {/* Legacy postMeal line (dashed, only shown if no slot readings) */}
                                                    <Line yAxisId="glucose" type="monotone" dataKey="postMeal"       name="Post-Meal (old)" stroke="#D97706" strokeWidth={1.5} dot={{ r: 2 }} connectNulls strokeDasharray="4 3" />
                                                </ComposedChart>
                                            </ResponsiveContainer>

                                            {/* Insight stat tiles */}
                                            <div style={{ display:'flex', gap:10, marginTop:14, flexWrap:'wrap' }}>
                                                {data.mealGlucoseInsight.hasNutritionInsight ? (
                                                    <>
                                                        <div style={{ flex:1, minWidth:100, background:'#FEF2F2', borderRadius:10, padding:'10px 12px' }}>
                                                            <div style={{ fontSize:16, fontWeight:700, color:'#EF4444' }}>{data.mealGlucoseInsight.avgGlucoseHighCarb} <span style={{ fontSize:10, fontWeight:400 }}>mg/dL</span></div>
                                                            <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>Avg glucose (high carb ≥50g)</div>
                                                        </div>
                                                        <div style={{ flex:1, minWidth:100, background:'#F0FDF4', borderRadius:10, padding:'10px 12px' }}>
                                                            <div style={{ fontSize:16, fontWeight:700, color:'#10B981' }}>{data.mealGlucoseInsight.avgGlucoseLowCarb} <span style={{ fontSize:10, fontWeight:400 }}>mg/dL</span></div>
                                                            <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>Avg glucose (low carb &lt;50g)</div>
                                                        </div>
                                                        <div style={{ flex:1, minWidth:100, background:'#EEF2FF', borderRadius:10, padding:'10px 12px' }}>
                                                            <div style={{ fontSize:16, fontWeight:700, color:'#6366F1' }}>{data.mealGlucoseInsight.avgDailyCarbs}g</div>
                                                            <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>Avg daily carb intake</div>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        {data.mealGlucoseInsight.avgGlucoseHighMeal != null && (
                                                            <div style={{ flex:1, minWidth:100, background:'#FEF2F2', borderRadius:10, padding:'10px 12px' }}>
                                                                <div style={{ fontSize:16, fontWeight:700, color:'#EF4444' }}>{data.mealGlucoseInsight.avgGlucoseHighMeal} <span style={{ fontSize:10, fontWeight:400 }}>mg/dL</span></div>
                                                                <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>Avg glucose on 3+ meal days</div>
                                                            </div>
                                                        )}
                                                        {data.mealGlucoseInsight.avgGlucoseLowMeal != null && (
                                                            <div style={{ flex:1, minWidth:100, background:'#F0FDF4', borderRadius:10, padding:'10px 12px' }}>
                                                                <div style={{ fontSize:16, fontWeight:700, color:'#10B981' }}>{data.mealGlucoseInsight.avgGlucoseLowMeal} <span style={{ fontSize:10, fontWeight:400 }}>mg/dL</span></div>
                                                                <div style={{ fontSize:11, color:'#6B7280', marginTop:2 }}>Avg glucose on 0–1 meal days</div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>

                                            {/* Dynamic insight text */}
                                            <div className="bs-insight" style={{ marginTop:12 }}>
                                                {data.mealGlucoseInsight.hasNutritionInsight ? (
                                                    data.mealGlucoseInsight.avgGlucoseHighCarb > data.mealGlucoseInsight.avgGlucoseLowCarb
                                                        ? `🍚 High-carb meals (≥50g) correlate with avg post-meal glucose of ${data.mealGlucoseInsight.avgGlucoseHighCarb} mg/dL vs ${data.mealGlucoseInsight.avgGlucoseLowCarb} mg/dL on low-carb days. Try swapping white rice for brown rice.`
                                                        : `✅ Great balance! Your post-meal glucose stays controlled even on high-carb days (${data.mealGlucoseInsight.avgGlucoseHighCarb} mg/dL). Keep logging meals for continued insights.`
                                                ) : data.mealGlucoseInsight.hasPairedData ? (
                                                    `🍽️ Use the food search in Record Data to find specific foods (e.g. Nasi Lemak, Roti Canai) — carb values will appear as coloured bars here automatically.`
                                                ) : (
                                                    '📋 Record post-meal glucose (After Breakfast / After Lunch / After Dinner) alongside your meals to see which meal affects your blood sugar the most.'
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ textAlign:'center', padding:'24px 0', color:'#9CA3AF' }}>
                                            <div style={{ fontSize:32, marginBottom:8 }}>🍽️</div>
                                            <div style={{ fontSize:13, fontWeight:600, color:'#374151', marginBottom:4 }}>No post-meal glucose recorded yet</div>
                                            <div style={{ fontSize:12 }}>Record an "After Breakfast", "After Lunch", or "After Dinner" glucose reading in Record Data to see this chart.</div>
                                        </div>
                                    )}
                                </div>

                                {/* ── Meal Logging Heatmap ── */}

                                <div className="card chart-card">
                                    <div className="prog-card-header" style={{ marginBottom: 12 }}>
                                        <span className="prog-card-icon" style={{ background: '#FFF7ED' }}>🗓️</span>
                                        <div>
                                            <div className="chart-title">Meal Logging Heatmap</div>
                                            <div className="chart-sub">5-week meal tracking consistency (last 35 days)</div>
                                        </div>
                                    </div>

                                    {/* Weekday labels */}
                                    <div className="heatmap-weekdays">
                                        {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d) => (
                                            <span key={d}>{d}</span>
                                        ))}
                                    </div>

                                    {/* Cells grid */}
                                    <div className="heatmap-grid">
                                        {/* leading blank cells to align first day */}
                                        {Array(heatmapDays[0].dow).fill(null).map((_, i) => (
                                            <div key={`blank-${i}`} className="heatmap-cell" style={{ background: 'transparent' }} />
                                        ))}
                                        {heatmapDays.map(({ dateStr, label }) => {
                                            const count = data.mealHeatmap[dateStr];
                                            return (
                                                <div
                                                    key={dateStr}
                                                    className="heatmap-cell"
                                                    style={{ background: heatColor(count) }}
                                                    title={`${label}: ${
                                                        count === undefined ? 'No log' : count === 0 ? 'Logged (0 meals)' : `${count} meal(s) logged`
                                                    }`}
                                                />
                                            );
                                        })}
                                    </div>

                                    {/* Legend */}
                                    <div className="heatmap-legend">
                                        <span className="heatmap-legend-label">0 meals</span>
                                        {[undefined, 1, 2, 3, 4].map((n, i) => (
                                            <div key={i} className="heatmap-cell" style={{ background: heatColor(n), width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                                        ))}
                                        <span className="heatmap-legend-label">4 meals</span>
                                    </div>
                                </div>

                                {/* ── Meal Distribution Donut ── */}
                                {data.mealDistribution.some((m) => m.value > 0) && (
                                    <div className="card chart-card">
                                        <div className="prog-card-header" style={{ marginBottom: 8 }}>
                                            <span className="prog-card-icon" style={{ background: '#FDF2F8' }}>🍽️</span>
                                            <div>
                                                <div className="chart-title">Meal Type Distribution</div>
                                                <div className="chart-sub">Which meals you log most often</div>
                                            </div>
                                        </div>
                                        <div className="meal-donut-wrap">
                                            <PieChart width={150} height={150}>
                                                <Pie
                                                    data={data.mealDistribution}
                                                    cx={70} cy={70}
                                                    innerRadius={42}
                                                    outerRadius={68}
                                                    dataKey="value"
                                                    strokeWidth={2}
                                                >
                                                    {data.mealDistribution.map((entry, i) => (
                                                        <Cell key={i} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip formatter={(val, name) => [`${val} days`, name]} contentStyle={{ fontSize: 12 }} />
                                            </PieChart>
                                            <div className="meal-donut-legend">
                                                {data.mealDistribution.map((m) => (
                                                    <div key={m.name} className="meal-donut-item">
                                                        <span className="meal-donut-dot" style={{ background: m.color }} />
                                                        <span className="meal-donut-name">{m.name}</span>
                                                        <span className="meal-donut-val" style={{ color: m.color }}>{m.value}d</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* RIGHT column – Key Metrics */}
                            <div className="prog-right">
                                <div className="card key-metrics-card">
                                    <div className="chart-title" style={{ marginBottom: 4 }}>Key Metrics</div>
                                    <div className="chart-sub" style={{ marginBottom: 18 }}>Your health statistics for the selected period</div>

                                    <div className="metric-item">
                                        <div className="metric-icon blue">💧</div>
                                        <div>
                                            <div className="metric-label">Average Water Intake</div>
                                            <div className="metric-val">{data.metrics.avgWater} <span>glasses/day</span></div>
                                        </div>
                                    </div>

                                    <div className="metric-item">
                                        <div className="metric-icon green">🍽️</div>
                                        <div>
                                            <div className="metric-label">Meals Logged</div>
                                            <div className="metric-val">{data.metrics.mealsLogged} <span>meals</span></div>
                                        </div>
                                    </div>

                                    <div className="metric-item">
                                        <div className="metric-icon purple">📅</div>
                                        <div>
                                            <div className="metric-label">Days Recorded</div>
                                            <div className="metric-val">{data.metrics.daysRecorded} <span>days</span></div>
                                        </div>
                                    </div>

                                    <div className="metric-item">
                                        <div className="metric-icon orange">📈</div>
                                        <div>
                                            <div className="metric-label">Blood Sugar Improvement</div>
                                            <div className={`metric-val ${
                                                data.metrics.improvement > 0 ? 'improvement'
                                                : data.metrics.improvement < 0 ? 'worsening'
                                                : ''
                                            }`}>
                                                {data.metrics.improvement > 0
                                                    ? `↓ -${data.metrics.improvement}% (improved)`
                                                    : data.metrics.improvement < 0
                                                    ? `↑ ${Math.abs(data.metrics.improvement)}% (higher)`
                                                    : 'No change'}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ── Food Logging Consistency ── */}
                                <div className="card food-consistency-card">
                                    <div className="prog-card-header" style={{ marginBottom: 14 }}>
                                        <span className="prog-card-icon" style={{ background: '#FFF7ED', fontSize: 18 }}>🍽️</span>
                                        <div>
                                            <div className="chart-title">Food Logging Consistency</div>
                                            <div className="chart-sub">How often you log each meal</div>
                                        </div>
                                    </div>

                                    <div className="food-consistency-list">
                                        {data.mealConsistency.map((item) => {
                                            const pct = item.total > 0
                                                ? Math.round((item.logged / item.total) * 100)
                                                : 0;
                                            return (
                                                <div key={item.label} className="food-consistency-row">
                                                    <div className="food-consistency-top">
                                                        <span className="food-consistency-label">
                                                            {item.emoji} {item.label}
                                                        </span>
                                                        <span className="food-consistency-count">
                                                            {item.logged}/{item.total} days
                                                            <span
                                                                className="food-consistency-pct"
                                                                style={{ color: item.color }}
                                                            >
                                                                {pct}%
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="food-consistency-track">
                                                        <div
                                                            className="food-consistency-fill"
                                                            style={{
                                                                width: `${pct}%`,
                                                                background: item.color,
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Overall tip */}
                                    {(() => {
                                        const allPcts = data.mealConsistency.slice(0, 4).map((m) =>
                                            m.total > 0 ? Math.round((m.logged / m.total) * 100) : 0
                                        );
                                        const overallAvg = Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length);
                                        return (
                                            <div className="food-consistency-insight">
                                                {overallAvg >= 80
                                                    ? '✅ Excellent meal logging! Consistent tracking helps better diabetes management.'
                                                    : overallAvg >= 50
                                                        ? '📝 Good start! Try to log all meals daily for better health insights.'
                                                        : '⚠️ Low meal logging. Regular food tracking is key to understanding your glucose patterns.'}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Health Tip */}
                                <div className="health-tip-card">
                                    <div className="health-tip-title">💡 Health Tip</div>
                                    <div className="health-tip-body">
                                        Consistency is key! Recording your meals daily helps link food choices to blood sugar patterns and improves diabetes prevention.
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
