/**
 * AdminLogs.jsx – System Logs page
 *
 * Reads REAL log entries from the `systemLogs` Firestore collection.
 * Entries are written there by logEvent.js whenever a genuine app action
 * occurs (login, logout, registration, data entry, etc.).
 *
 * Features: live listener, search, level filter, category filter,
 *           pagination (15/page), export CSV
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, query, orderBy, onSnapshot, limit, doc, getDoc } from 'firebase/firestore';
import AdminSidebar from '../components/AdminSidebar';
import './admin.css';

/* ── Log level config ───────────────────────────────── */
const LEVEL_CONFIG = {
    INFO:    { bg: '#DBEAFE', color: '#1D4ED8', icon: 'ℹ️' },
    SUCCESS: { bg: '#D1FAE5', color: '#059669', icon: '✅' },
    WARNING: { bg: '#FEF3C7', color: '#D97706', icon: '⚠️' },
    ERROR:   { bg: '#FEE2E2', color: '#DC2626', icon: '❌' },
};

const CATEGORIES = [
    'All Categories', 'User Login', 'User Logout', 'User Registration',
    'Data Entry', 'Authentication', 'Data Export', 'System Performance',
    'Settings Saved', 'Achievement', 'Notification', 'Admin Action',
];

const PAGE_SIZE = 15;

/* ── Time helpers ───────────────────────────────────── */
function tsToMs(ts) {
    if (!ts) return Date.now();
    return ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
}

function relativeTime(ms) {
    const diff = Date.now() - ms;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

function exactTime(ms) {
    return new Date(ms).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/* ── Export to CSV ──────────────────────────────────── */
function exportCSV(logs) {
    const header = 'Level,Category,User,Message,Timestamp\n';
    const rows = logs.map((l) =>
        `${l.level},${l.category},"${l.user}","${l.message}",${exactTime(l.ts)}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `system_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ── Level Badge ────────────────────────────────────── */
function LevelBadge({ level }) {
    const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG.INFO;
    return (
        <span className="log-level-badge" style={{ background: cfg.bg, color: cfg.color }}>
            {level}
        </span>
    );
}

/* ── Category Badge ─────────────────────────────────── */
const CAT_COLORS = {
    'User Login':        '#EDE9FE', 'User Logout':      '#F3F4F6',
    'User Registration': '#DBEAFE', 'Data Entry':       '#D1FAE5',
    'Authentication':    '#FEF3C7', 'Data Export':      '#E0F2FE',
    'System Performance':'#F0FDF4', 'Settings Saved':   '#ECFDF5',
    'Achievement':       '#FEF9C3', 'Notification':     '#FCE7F3',
    'Admin Action':      '#FEE2E2',
};

function CatBadge({ cat }) {
    return (
        <span className="log-cat-badge" style={{ background: CAT_COLORS[cat] || '#F3F4F6' }}>
            {cat}
        </span>
    );
}

export default function AdminLogs() {
    const navigate = useNavigate();
    const [adminUser, setAdminUser]  = useState(null);
    const [allLogs,   setAllLogs]    = useState([]);
    const [loading,   setLoading]    = useState(true);
    const [showLogout, setShowLogout] = useState(false);

    /* ── Filters ── */
    const [search,      setSearch] = useState('');
    const [levelFilter, setLevel]  = useState('All Levels');
    const [catFilter,   setCat]    = useState('All Categories');
    const [page,        setPage]   = useState(1);

    /* ── Auth guard ── */
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
        });
        return () => unsub();
    }, [navigate]);

    /* ── Real-time listener on systemLogs collection ── */
    useEffect(() => {
        if (!adminUser) return;

        // Set loading before subscribing (moved outside effect body via ref pattern
        // to avoid synchronous setState inside effect — use the snapshot callback instead)
        const q = query(
            collection(db, 'systemLogs'),
            orderBy('createdAt', 'desc'),
            limit(500)
        );

        const unsub = onSnapshot(q, (snap) => {
            const logs = snap.docs.map((d) => {
                const data = d.data();
                return {
                    id:       d.id,
                    level:    data.level    || 'INFO',
                    category: data.category || 'System Performance',
                    user:     data.user     || 'system',
                    message:  data.message  || '',
                    ts:       tsToMs(data.createdAt),
                };
            });
            setAllLogs(logs);
            setLoading(false);
        }, (err) => {
            console.error('systemLogs listener error:', err);
            setLoading(false);
        });

        return () => unsub();
    }, [adminUser]);

    /* ── Filtering ── */
    const filtered = allLogs.filter((l) => {
        if (levelFilter !== 'All Levels'     && l.level    !== levelFilter) return false;
        if (catFilter   !== 'All Categories' && l.category !== catFilter)   return false;
        if (search) {
            const q = search.toLowerCase();
            if (
                !l.message.toLowerCase().includes(q) &&
                !l.user.toLowerCase().includes(q) &&
                !l.category.toLowerCase().includes(q)
            ) return false;
        }
        return true;
    });

    /* ── Pagination ── */
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const pageLogs   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    /* ── Quick stats ── */
    const countByLevel = (lvl) => allLogs.filter((l) => l.level === lvl).length;

    const handleLogout = async () => {
        await signOut(auth);
        navigate('/login');
    };

    return (
        <>
            <div className="admin-layout">
                <AdminSidebar onLogout={() => setShowLogout(true)} />

                <div className="admin-main">
                    {/* ── Top Bar ── */}
                    <header className="admin-topbar">
                        <div className="admin-topbar-left">
                            <div className="admin-page-title">System Logs</div>
                            <div className="admin-page-sub">
                                {loading ? 'Loading…' : `${allLogs.length} real events recorded`}
                            </div>
                        </div>
                        <div className="admin-topbar-right">
                            <button
                                className="rules-save-btn"
                                onClick={() => exportCSV(filtered)}
                                style={{ padding: '7px 18px', fontSize: 13 }}
                            >
                                ⬇ Export
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
                        {/* ── 4 Quick Stat Badges ── */}
                        <div className="logs-stat-row">
                            {[
                                { label: 'Info',     level: 'INFO',    color: '#3B82F6' },
                                { label: 'Errors',   level: 'ERROR',   color: '#EF4444' },
                                { label: 'Warnings', level: 'WARNING', color: '#F59E0B' },
                                { label: 'Success',  level: 'SUCCESS', color: '#10B981' },
                            ].map((s) => (
                                <div
                                    key={s.level}
                                    className={`logs-stat-chip ${levelFilter === s.level ? 'active' : ''}`}
                                    onClick={() => {
                                        setLevel(levelFilter === s.level ? 'All Levels' : s.level);
                                        setPage(1);
                                    }}
                                    style={{ '--chip-color': s.color }}
                                >
                                    <span className="logs-stat-count" style={{ color: s.color }}>
                                        {loading ? '…' : countByLevel(s.level)}
                                    </span>
                                    <span className="logs-stat-label">{s.label}</span>
                                </div>
                            ))}
                        </div>

                        {/* ── Search + Filters ── */}
                        <div className="admin-users-toolbar">
                            <div className="admin-search-wrap">
                                <span className="admin-search-icon">🔍</span>
                                <input
                                    className="admin-search-input"
                                    placeholder="Search logs by message, user, or category…"
                                    value={search}
                                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                                />
                            </div>
                            <select
                                className="admin-filter-select"
                                value={levelFilter}
                                onChange={(e) => { setLevel(e.target.value); setPage(1); }}
                            >
                                {['All Levels', 'INFO', 'SUCCESS', 'WARNING', 'ERROR'].map((l) => (
                                    <option key={l}>{l}</option>
                                ))}
                            </select>
                            <select
                                className="admin-filter-select"
                                value={catFilter}
                                onChange={(e) => { setCat(e.target.value); setPage(1); }}
                            >
                                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                        </div>

                        {/* ── Logs List ── */}
                        <div className="admin-users-full-card" style={{ padding: '0' }}>
                            {loading ? (
                                <div className="admin-loading" style={{ padding: 48 }}>Loading system logs…</div>
                            ) : pageLogs.length === 0 ? (
                                <div className="admin-empty" style={{ padding: 48, textAlign: 'center' }}>
                                    {allLogs.length === 0
                                        ? '📋 No events recorded yet. Events will appear here as users log in, register, and record data.'
                                        : 'No logs match your filters.'}
                                </div>
                            ) : (
                                <>
                                    {pageLogs.map((log, idx) => {
                                        const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.INFO;
                                        return (
                                            <div
                                                key={log.id}
                                                className="log-entry"
                                                style={{ borderTop: idx === 0 ? 'none' : '1px solid #F3F4F6' }}
                                            >
                                                {/* Colour bar */}
                                                <div className="log-entry-bar" style={{ background: cfg.color }} />

                                                {/* Icon */}
                                                <div className="log-entry-icon">{cfg.icon}</div>

                                                {/* Main content */}
                                                <div className="log-entry-body">
                                                    <div className="log-entry-top">
                                                        <LevelBadge level={log.level} />
                                                        <CatBadge   cat={log.category} />
                                                        <span className="log-entry-user">{log.user}</span>
                                                    </div>
                                                    <div className="log-entry-message">{log.message}</div>
                                                </div>

                                                {/* Timestamp */}
                                                <div className="log-entry-time">
                                                    <div className="log-time-relative">{relativeTime(log.ts)}</div>
                                                    <div className="log-time-exact">{exactTime(log.ts)}</div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* ── Pagination ── */}
                                    <div className="logs-pagination">
                                        <span className="logs-page-info">
                                            Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–
                                            {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} logs
                                        </span>
                                        <div className="logs-page-buttons">
                                            <button
                                                className="logs-page-btn"
                                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                                disabled={page === 1}
                                            >
                                                ← Previous
                                            </button>
                                            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                                                const pageNum = i + 1;
                                                return (
                                                    <button
                                                        key={pageNum}
                                                        className={`logs-page-btn ${page === pageNum ? 'current' : ''}`}
                                                        onClick={() => setPage(pageNum)}
                                                    >
                                                        {pageNum}
                                                    </button>
                                                );
                                            })}
                                            <button
                                                className="logs-page-btn"
                                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                                disabled={page === totalPages}
                                            >
                                                Next →
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
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
                            <button className="logout-btn-cancel" onClick={() => setShowLogout(false)}>Cancel</button>
                            <button className="logout-btn-confirm" onClick={handleLogout}>Yes, Log Out</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
