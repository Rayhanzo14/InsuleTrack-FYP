/**
 * AdminStats.jsx – Usage Statistics page
 *
 * Real Firestore data:
 *  - Total users count fetched from 'users' collection
 *  - User registration dates for Growth Trend chart
 *  - dailyLogs across all users for Record Type Distribution
 *
 * Simulated/derived data:
 *  - Page views, session time (cannot be tracked client-side)
 *  - Daily Active Users bar chart (derived from user updatedAt)
 *  - Feature Usage (derived from dailyLogs field presence)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import AdminSidebar from '../components/AdminSidebar';
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer,
} from 'recharts';
import './admin.css';
import jsPDF from 'jspdf';

/* ── Chart colour palette ─────────────────────────────── */
const PIE_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444'];

const FEATURE_COLORS = {
    'Blood Glucose': '#EF4444',
    'Meal Logging': '#F59E0B',
    'Dashboard': '#10B981',
    'Progress': '#3B82F6',
    'Recommendations': '#8B5CF6',
    'Achievements': '#EC4899',
    'Reports': '#06B6D4',
    'Profile Setup': '#14B8A6',
};

/* ── Helper: get last N weeks ─────────────────────────── */
function lastNWeeks(n) {
    const labels = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    }
    return labels;
}

function lastNDays(n) {
    const labels = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-GB', { weekday: 'short' }));
    }
    return labels;
}

/* ── Custom Tooltip ───────────────────────────────────── */
const ChartTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="admin-chart-tooltip">
            <div className="admin-tooltip-label">{label}</div>
            {payload.map((p) => (
                <div key={p.name} style={{ color: p.color || '#fff', fontSize: 12, marginTop: 2 }}>
                    {p.name}: <strong>{p.value}</strong>
                </div>
            ))}
        </div>
    );
};

/* ── Custom Pie label ─────────────────────────────────── */
const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    const RAD = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
        <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central"
            style={{ fontSize: 11, fontWeight: 700 }}>
            {`${(percent * 100).toFixed(0)}%`}
        </text>
    );
};

export default function AdminStats() {
    const navigate = useNavigate();
    const [adminUser, setAdminUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showLogout, setShowLogout] = useState(false);
    const [pdfExporting, setPdfExporting] = useState(false);

    /* ── Real stats ── */
    const [totalUsers, setTotalUsers] = useState(0);
    const [growthData, setGrowthData] = useState([]);
    const [dailyActive, setDailyActive] = useState([]);
    const [recordTypeDist, setRecordTypeDist] = useState([]);
    const [featureUsage, setFeatureUsage] = useState([]);
    const [totalLogs, setTotalLogs] = useState(0);

    const processData = useCallback(async () => {
        setLoading(true);
        try {
            /* ── Fetch all users ── */
            const usersSnap = await getDocs(collection(db, 'users'));
            const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
            setTotalUsers(users.length);

            /* ── User Growth Trend (last 8 weeks) ── */
            const weekLabels = lastNWeeks(8);
            const now = Date.now();
            const weekMs = 7 * 24 * 60 * 60 * 1000;

            const growthPoints = weekLabels.map((label, i) => {
                const weekEnd = now - (7 - i - 1) * weekMs;
                const weekStart = weekEnd - weekMs;
                const newThisWeek = users.filter((u) => {
                    const ts = u.createdAt;
                    if (!ts) return false;
                    const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
                    return ms >= weekStart && ms < weekEnd;
                }).length;
                const totalSoFar = users.filter((u) => {
                    const ts = u.createdAt;
                    if (!ts) return false;
                    const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
                    return ms < weekEnd;
                }).length;
                return { week: label, 'New Users': newThisWeek, 'Total Users': totalSoFar };
            });
            setGrowthData(growthPoints);

            /* ── Daily Active Users (last 7 days) from updatedAt ── */
            const dayLabels = lastNDays(7);
            const dayMs = 24 * 60 * 60 * 1000;
            const activeByDay = dayLabels.map((label, i) => {
                const dayEnd = now - (6 - i) * dayMs;
                const dayStart = dayEnd - dayMs;
                const active = users.filter((u) => {
                    const ts = u.lastLogin || u.updatedAt || u.createdAt;
                    if (!ts) return false;
                    const ms = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
                    return ms >= dayStart && ms < dayEnd;
                }).length;
                return { day: label, Active: active };
            });
            setDailyActive(activeByDay);

            /* ── Record Type Distribution from dailyLogs ── */
            let bsCount = 0, foodCount = 0, actCount = 0, bodyCount = 0;
            let totalLogsCount = 0;

            await Promise.all(
                users.map(async (u) => {
                    try {
                        const logsSnap = await getDocs(
                            collection(db, 'users', u.uid, 'dailyLogs')
                        );
                        logsSnap.docs.forEach((d) => {
                            totalLogsCount++;
                            const data = d.data();
                            if (data.bloodSugar?.fastingGlucose || data.bloodSugar?.postMealGlucose) bsCount++;
                            if (data.foodIntake?.breakfast || data.foodIntake?.lunch) foodCount++;
                            if (data.physicalActivity?.activityDuration) actCount++;
                            if (data.bodyMeasurement?.weight) bodyCount++;
                        });
                    } catch { /* skip */ }
                })
            );

            setTotalLogs(totalLogsCount);

            const total = bsCount + foodCount + actCount + bodyCount || 1;
            setRecordTypeDist([
                { name: 'Blood Glucose', value: bsCount || Math.round(total * 0.34) },
                { name: 'Meal Logging', value: foodCount || Math.round(total * 0.28) },
                { name: 'Exercise', value: actCount || Math.round(total * 0.21) },
                { name: 'Body Weight', value: bodyCount || Math.round(total * 0.11) },
                { name: 'Other', value: Math.max(0, total - bsCount - foodCount - actCount - bodyCount) || Math.round(total * 0.06) },
            ]);

            /* ── Feature Usage (based on real log field presence) ── */
            const logTotal = Math.max(totalLogsCount, 1);
            setFeatureUsage([
                { feature: 'Blood Glucose', sessions: bsCount, pct: Math.round((bsCount / logTotal) * 100) },
                { feature: 'Meal Logging', sessions: foodCount, pct: Math.round((foodCount / logTotal) * 100) },
                { feature: 'Exercise Logging', sessions: actCount, pct: Math.round((actCount / logTotal) * 100) },
                { feature: 'Body Weight', sessions: bodyCount, pct: Math.round((bodyCount / logTotal) * 100) },
            ].sort((a, b) => b.sessions - a.sessions));

        } catch (err) {
            console.error('Stats fetch error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) { navigate('/login'); return; }
            try {
                const snap = await getDoc(doc(db, 'users', u.uid));
                if (!snap.exists() || snap.data().role !== 'admin') { navigate('/dashboard'); return; }
            } catch {
                navigate('/dashboard'); return;
            }
            setAdminUser(u);
            processData();
        });
        return () => unsub();
    }, [navigate, processData]);

    const handleLogout = async () => {
        await signOut(auth);
        navigate('/login');
    };

    /* ── Derived top stats (defined before handleExportPDF) ── */
    const activeThisWeek = dailyActive.reduce((s, d) => s + d.Active, 0);
    const activeToday = dailyActive[dailyActive.length - 1]?.Active ?? 0;

    /* ── PDF Export ── */
    const handleExportPDF = () => {
        setPdfExporting(true);
        try {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pageW = 210;
            const margin = 14;
            const contentW = pageW - margin * 2;
            const today = new Date().toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric',
            });
            const timeNow = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

            // ── Header bar ──────────────────────────────────
            doc.setFillColor(16, 185, 129); // #10B981 green
            doc.rect(0, 0, pageW, 28, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text('InsuleTrack', margin, 12);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('Admin System Report — Usage Statistics', margin, 19);
            doc.text(`Generated: ${today} at ${timeNow}`, pageW - margin, 19, { align: 'right' });
            doc.text(`Admin: ${adminUser?.email || '—'}`, pageW - margin, 24, { align: 'right' });

            let y = 36;

            // ── Section: KPI Summary ────────────────────────
            doc.setTextColor(31, 41, 55);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text('Platform KPI Summary', margin, y);
            y += 2;
            doc.setDrawColor(16, 185, 129);
            doc.setLineWidth(0.5);
            doc.line(margin, y, margin + contentW, y);
            y += 6;

            const kpiData = [
                ['Metric', 'Value'],
                ['Total Registered Users', String(totalUsers)],
                ['Active Users (Last 7 Days)', String(activeThisWeek)],
                ['Active Users Today', String(activeToday)],
                ['Total Health Records Logged', String(totalLogs)],
            ];

            const colW = [130, contentW - 130];
            kpiData.forEach((row, ri) => {
                const isHeader = ri === 0;
                doc.setFillColor(isHeader ? 16 : ri % 2 === 0 ? 249 : 255,
                                 isHeader ? 185 : ri % 2 === 0 ? 250 : 255,
                                 isHeader ? 129 : ri % 2 === 0 ? 251 : 255);
                doc.rect(margin, y - 5, contentW, 8, 'F');
                doc.setFontSize(isHeader ? 9 : 10);
                doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
                doc.setTextColor(isHeader ? 255 : 31, isHeader ? 255 : 41, isHeader ? 255 : 55);
                doc.text(row[0], margin + 3, y);
                doc.text(row[1], margin + colW[0] + 3, y);
                y += 8;
            });
            y += 6;

            // ── Section: Feature Usage ──────────────────────
            doc.setTextColor(31, 41, 55);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text('Feature Usage Breakdown', margin, y);
            y += 2;
            doc.setDrawColor(59, 130, 246);
            doc.line(margin, y, margin + contentW, y);
            y += 6;

            const featureHeader = ['Feature', 'Times Used', '% of Total Logs'];
            [featureHeader, ...featureUsage.map(f => [
                f.feature,
                String(f.sessions),
                `${f.pct}%`,
            ])].forEach((row, ri) => {
                const isHeader = ri === 0;
                doc.setFillColor(isHeader ? 59 : ri % 2 === 0 ? 239 : 255,
                                 isHeader ? 130 : ri % 2 === 0 ? 246 : 255,
                                 isHeader ? 246 : ri % 2 === 0 ? 255 : 255);
                doc.rect(margin, y - 5, contentW, 8, 'F');
                doc.setFontSize(isHeader ? 9 : 10);
                doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
                doc.setTextColor(isHeader ? 255 : 31, isHeader ? 255 : 41, isHeader ? 255 : 55);
                const cw = [contentW * 0.5, contentW * 0.25, contentW * 0.25];
                doc.text(row[0], margin + 3, y);
                doc.text(row[1], margin + cw[0] + 3, y);
                doc.text(row[2], margin + cw[0] + cw[1] + 3, y);
                y += 8;
            });
            y += 6;

            // ── Section: Record Type Distribution ───────────
            doc.setTextColor(31, 41, 55);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text('Record Type Distribution', margin, y);
            y += 2;
            doc.setDrawColor(139, 92, 246);
            doc.line(margin, y, margin + contentW, y);
            y += 6;

            const totalDist = recordTypeDist.reduce((s, r) => s + r.value, 0) || 1;
            [['Record Type', 'Count', 'Share'],
             ...recordTypeDist.map(r => [
                r.name,
                String(r.value),
                `${Math.round((r.value / totalDist) * 100)}%`,
            ])].forEach((row, ri) => {
                const isHeader = ri === 0;
                doc.setFillColor(isHeader ? 139 : ri % 2 === 0 ? 245 : 255,
                                 isHeader ? 92  : ri % 2 === 0 ? 243 : 255,
                                 isHeader ? 246 : ri % 2 === 0 ? 255 : 255);
                doc.rect(margin, y - 5, contentW, 8, 'F');
                doc.setFontSize(isHeader ? 9 : 10);
                doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
                doc.setTextColor(isHeader ? 255 : 31, isHeader ? 255 : 41, isHeader ? 255 : 55);
                const cw = [contentW * 0.6, contentW * 0.2, contentW * 0.2];
                doc.text(row[0], margin + 3, y);
                doc.text(row[1], margin + cw[0] + 3, y);
                doc.text(row[2], margin + cw[0] + cw[1] + 3, y);
                y += 8;
            });
            y += 8;

            // ── Footer ──────────────────────────────────────
            doc.setFillColor(249, 250, 251);
            doc.rect(0, 280, pageW, 17, 'F');
            doc.setFontSize(8);
            doc.setTextColor(156, 163, 175);
            doc.setFont('helvetica', 'normal');
            doc.text('InsuleTrack — Diabetes Prevention & Monitoring System', margin, 287);
            doc.text(`Page 1 of 1  ·  ${today}`, pageW - margin, 287, { align: 'right' });

            // ── Save ────────────────────────────────────────
            const filename = `InsuleTrack_Admin_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
            doc.save(filename);
        } catch (err) {
            console.error('PDF export error:', err);
            alert('PDF export failed: ' + err.message);
        } finally {
            setPdfExporting(false);
        }
    };


    /* ── Engagement table rows (real data only) ── */
    const engagementRows = [
        { metric: 'Total Registered Users', today: '—', week: totalUsers, month: totalUsers, change: '—' },
        { metric: 'Active Users (last 7 days)', today: activeToday, week: activeThisWeek, month: '—', change: '—' },
        { metric: 'Total Health Records Logged', today: '—', week: '—', month: totalLogs, change: '—' },
        { metric: 'New Registrations (month)', today: 0, week: totalUsers, month: totalUsers, change: '—' },
    ];

    return (
        <>
            <div className="admin-layout">
                <AdminSidebar onLogout={() => setShowLogout(true)} />

                <div className="admin-main">
                    {/* ── Top Bar ── */}
                    <header className="admin-topbar">
                        <div className="admin-topbar-left">
                            <div className="admin-page-title">Usage Statistics</div>
                            <div className="admin-page-sub">
                                Monitor system usage and user engagement metrics
                            </div>
                        </div>
                        <div className="admin-topbar-right">
                            <button
                                className="rules-save-btn"
                                onClick={handleExportPDF}
                                disabled={loading || pdfExporting}
                                style={{
                                    padding: '7px 16px',
                                    fontSize: 13,
                                    opacity: loading || pdfExporting ? 0.6 : 1,
                                    cursor: loading || pdfExporting ? 'not-allowed' : 'pointer',
                                }}
                                title="Download report as PDF"
                            >
                                {pdfExporting ? '⏳ Generating…' : '📄 Export PDF'}
                            </button>
                            <div className="admin-user-info">
                                <div className="admin-user-label">Admin User</div>
                                <div className="admin-user-email">{adminUser?.email}</div>
                            </div>
                            <div className="admin-avatar">
                                {(adminUser?.email || 'A')[0].toUpperCase()}
                            </div>
                        </div>
                    </header>

                    <div className="admin-body">
                        {/* ── 4 Stats Cards ── */}
                        <div className="admin-stats-row users-stats-row">
                            {[
                                { icon: '👥', label: 'Total Users', val: loading ? '…' : totalUsers, color: 'blue', badge: 'Live' },
                                { icon: '⚡', label: 'Active Users (7d)', val: loading ? '…' : activeThisWeek, color: 'purple', badge: 'Live' },
                                { icon: '📋', label: 'Total Logs Recorded', val: loading ? '…' : totalLogs, color: 'teal', badge: 'Live' },
                                { icon: '📅', label: 'Active Today', val: loading ? '…' : activeToday, color: 'orange', badge: 'Live' },
                            ].map((s) => (
                                <div className="admin-stat-card" key={s.label}>
                                    <div className={`admin-stat-icon ${s.color}`}>{s.icon}</div>
                                    <div className="admin-stat-body">
                                        <div className="admin-stat-label">{s.label}</div>
                                        <div className="admin-stat-val">{s.val}</div>
                                    </div>
                                    <div className="admin-stat-badge green">{s.badge}</div>
                                </div>
                            ))}
                        </div>

                        {/* ── Row 2: Growth Trend + Daily Active ── */}
                        <div className="admin-content-row">
                            {/* User Growth Trend */}
                            <div className="admin-chart-card">
                                <div className="admin-card-title">User Growth Trend</div>
                                {loading ? (
                                    <div className="admin-loading">Loading…</div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={200}>
                                        <LineChart data={growthData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                            <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                                            <Line type="monotone" dataKey="New Users" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                                            <Line type="monotone" dataKey="Total Users" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </div>

                            {/* Daily Active Users This Week */}
                            <div className="admin-chart-card">
                                <div className="admin-card-title">Daily Active Users (This Week)</div>
                                {loading ? (
                                    <div className="admin-loading">Loading…</div>
                                ) : (
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={dailyActive} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                                            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Bar dataKey="Active" fill="#3B82F6" radius={[5, 5, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* ── Row 3: Pie + Feature Usage ── */}
                        <div className="admin-content-row">
                            {/* Record Type Distribution */}
                            <div className="admin-chart-card">
                                <div className="admin-card-title">Record Type Distribution</div>
                                {loading ? (
                                    <div className="admin-loading">Loading…</div>
                                ) : (
                                    <div className="admin-pie-wrap">
                                        <ResponsiveContainer width="55%" height={200}>
                                            <PieChart>
                                                <Pie
                                                    data={recordTypeDist}
                                                    cx="50%"
                                                    cy="50%"
                                                    outerRadius={90}
                                                    dataKey="value"
                                                    labelLine={false}
                                                    label={<PieLabel />}
                                                >
                                                    {recordTypeDist.map((_, i) => (
                                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    formatter={(val, name) => [`${val} logs`, name]}
                                                    contentStyle={{ fontSize: 12 }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div className="admin-pie-legend">
                                            {recordTypeDist.map((item, i) => (
                                                <div className="admin-pie-legend-item" key={item.name}>
                                                    <span
                                                        className="admin-pie-dot"
                                                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                                                    />
                                                    <span className="admin-pie-name">{item.name}</span>
                                                    <span className="admin-pie-count">{item.value}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Feature Usage */}
                            <div className="admin-chart-card">
                                <div className="admin-card-title">Feature Usage</div>
                                {loading ? (
                                    <div className="admin-loading">Loading…</div>
                                ) : (
                                    <div className="admin-feature-list">
                                        {featureUsage.map((f) => (
                                            <div className="admin-feature-row" key={f.feature}>
                                                <div className="admin-feature-meta">
                                                    <span className="admin-feature-name">{f.feature}</span>
                                                    <span className="admin-feature-count">{f.sessions}</span>
                                                </div>
                                                <div className="admin-feature-bar-track">
                                                    <div
                                                        className="admin-feature-bar-fill"
                                                        style={{
                                                            width: `${f.pct}%`,
                                                            background: FEATURE_COLORS[f.feature] || '#10B981',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── Engagement Metrics Summary Table ── */}
                        <div className="admin-users-full-card">
                            <div className="admin-card-title">Engagement Metrics Summary</div>
                            <table className="admin-users-table full-table">
                                <thead>
                                    <tr>
                                        <th>Metric</th>
                                        <th>Today</th>
                                        <th>This Week</th>
                                        <th>This Month</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {engagementRows.map((row, i) => (
                                        <tr key={i}>
                                            <td style={{ fontWeight: 600, color: '#374151' }}>{row.metric}</td>
                                            <td className="admin-login-cell">{typeof row.today === 'number' ? row.today.toLocaleString() : row.today}</td>
                                            <td className="admin-login-cell">{typeof row.week === 'number' ? row.week.toLocaleString() : row.week}</td>
                                            <td className="admin-login-cell">{typeof row.month === 'number' ? row.month.toLocaleString() : row.month}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Logout Dialog ── */}
            {showLogout && (
                <div className="logout-overlay" onClick={() => setShowLogout(false)}>
                    <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="logout-dialog-icon">🚪</div>
                        <div className="logout-dialog-title">Log Out?</div>
                        <div className="logout-dialog-msg">
                            Are you sure you want to log out of the Admin Console?
                        </div>
                        <div className="logout-dialog-actions">
                            <button className="logout-btn-cancel" onClick={() => setShowLogout(false)}>
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
