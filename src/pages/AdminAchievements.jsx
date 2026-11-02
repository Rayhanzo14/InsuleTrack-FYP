import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import {
    collection, getDocs, doc, getDoc, deleteDoc,
    addDoc, writeBatch, serverTimestamp
} from 'firebase/firestore';
import AdminSidebar from '../components/AdminSidebar';
import './admin.css';

const DEFAULT_ACHIEVEMENTS = [
    { title: 'First Steps',       desc: 'Record your first data entry',                          category: 'Tracking',    total: 1,      icon: '👣' },
    { title: 'Early Bird',        desc: 'Log data before 9 AM on 10 occasions',                  category: 'Tracking',    total: 10,     icon: '🌅' },
    { title: 'Lifestyle Legend',  desc: 'Achieve 100 total tracking entries',                     category: 'Tracking',    total: 100,    icon: '🌟' },
    { title: 'Week Warrior',      desc: 'Track your health for 7 consecutive days',              category: 'Consistency', total: 7,      icon: '🔥' },
    { title: 'Two Week Streak',   desc: 'Maintain a 14-day tracking streak',                     category: 'Consistency', total: 14,     icon: '💪' },
    { title: 'Month Master',      desc: 'Track your health for 30 days',                         category: 'Consistency', total: 30,     icon: '📅' },
    { title: 'Health Champion',   desc: 'Track your health for 90 days',                         category: 'Consistency', total: 90,     icon: '🏆' },
    { title: 'Prevention Hero',   desc: 'Complete comprehensive tracking for 60 days',            category: 'Consistency', total: 60,     icon: '🛡️' },
    { title: 'Active Starter',    desc: 'Log physical activity 10 times',                        category: 'Activity',    total: 10,     icon: '⚡' },
    { title: 'Fitness Enthusiast',desc: 'Log physical activity 30 times',                        category: 'Activity',    total: 30,     icon: '🏃' },
    { title: 'Fitness Guru',      desc: 'Log 30+ minutes of activity 50 times',                  category: 'Activity',    total: 50,     icon: '🏋️' },
    { title: 'Step Starter',      desc: 'Track your daily steps 10 times',                       category: 'Activity',    total: 10,     icon: '👟' },
    { title: 'Step Champion',     desc: 'Reach 10,000 steps in a single day',                    category: 'Activity',    total: 1,      icon: '🥇' },
    { title: 'Step Master',       desc: 'Achieve 10,000+ steps on 30 days',                      category: 'Activity',    total: 30,     icon: '🎯' },
    { title: 'Walking Legend',    desc: 'Accumulate 100,000 total steps',                        category: 'Activity',    total: 100000, icon: '🚶' },
    { title: 'Sugar Monitor',     desc: 'Track blood sugar levels 75 times',                     category: 'Health',      total: 75,     icon: '🩸' },
    { title: 'Sugar Expert',      desc: 'Track blood sugar levels 50 times',                     category: 'Health',      total: 50,     icon: '🔬' },
    { title: 'Weight Tracker',    desc: 'Track weight measurements 20 times',                    category: 'Health',      total: 20,     icon: '⚖️' },
    { title: 'Balanced Eater',    desc: 'Log 90 meals across breakfast, lunch, dinner, snacks',  category: 'Health',      total: 90,     icon: '🥗' },
    { title: 'Hydration Hero',    desc: 'Stay well hydrated (8+ glasses) for 30 days',           category: 'Health',      total: 30,     icon: '💧' },
];

const CATEGORIES = ['Tracking', 'Consistency', 'Activity', 'Health'];

const CAT_COLOR = {
    Tracking:    { pill: '#DBEAFE', text: '#1D4ED8', bar: '#3B82F6' },
    Consistency: { pill: '#EDE9FE', text: '#6D28D9', bar: '#8B5CF6' },
    Activity:    { pill: '#D1FAE5', text: '#059669', bar: '#10B981' },
    Health:      { pill: '#FCE7F3', text: '#BE185D', bar: '#EC4899' },
};

const BLANK_FORM = { title: '', desc: '', icon: '🏅', category: 'Tracking', total: 1 };

export default function AdminAchievements() {
    const navigate = useNavigate();
    const [adminUser,       setAdminUser]       = useState(null);
    const [achievements,    setAchievements]    = useState([]);
    const [users,           setUsers]           = useState([]);
    const [loading,         setLoading]         = useState(true);
    const [showLogout,      setShowLogout]      = useState(false);
    const [showAddModal,    setShowAddModal]     = useState(false);
    const [showDeleteId,    setShowDeleteId]    = useState(null);
    const [showReset,       setShowReset]       = useState(false);
    const [form,            setForm]            = useState(BLANK_FORM);
    const [saving,          setSaving]          = useState(false);
    const [msg,             setMsg]             = useState('');
    const [categoryFilter,  setCategoryFilter]  = useState('All');

    /* ── Seed Firestore if empty ── */
    const seedIfEmpty = useCallback(async () => {
        const snap = await getDocs(collection(db, 'achievements'));
        if (snap.empty) {
            const batch = writeBatch(db);
            DEFAULT_ACHIEVEMENTS.forEach((a) => {
                batch.set(doc(collection(db, 'achievements')), { ...a, createdAt: serverTimestamp() });
            });
            await batch.commit();
        }
    }, []);

    /* ── Load achievements + users ── */
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            await seedIfEmpty();
            const [achSnap, usersSnap] = await Promise.all([
                getDocs(collection(db, 'achievements')),
                getDocs(collection(db, 'users')),
            ]);
            setAchievements(achSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setUsers(usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() })));
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [seedIfEmpty]);

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
            loadData();
        });
        return () => unsub();
    }, [navigate, loadData]);

    /* ── Add achievement ── */
    const handleAdd = async (e) => {
        e.preventDefault();
        if (!form.title.trim() || !form.desc.trim()) return;
        setSaving(true);
        try {
            await addDoc(collection(db, 'achievements'), {
                ...form,
                total: Number(form.total) || 1,
                createdAt: serverTimestamp(),
            });
            setMsg('✅ Achievement added successfully.');
            setShowAddModal(false);
            setForm(BLANK_FORM);
            loadData();
        } catch (err) {
            setMsg('❌ Failed: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    /* ── Delete achievement ── */
    const handleDelete = async (id) => {
        try {
            await deleteDoc(doc(db, 'achievements', id));
            setMsg('🗑️ Achievement removed.');
            setShowDeleteId(null);
            loadData();
        } catch (err) {
            setMsg('❌ Delete failed: ' + err.message);
        }
    };

    /* ── Reset all ── */
    const handleReset = async () => {
        try {
            await Promise.all(users.map(async (u) => {
                const snap = await getDocs(collection(db, 'users', u.uid, 'checkins'));
                await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
            }));
            setMsg('✅ All user streak and check-in progress has been reset.');
        } catch (err) {
            setMsg('❌ Reset failed: ' + err.message);
        } finally {
            setShowReset(false);
        }
    };

    const filtered = categoryFilter === 'All'
        ? achievements
        : achievements.filter((a) => a.category === categoryFilter);

    /* ── Category breakdown ── */
    const catStats = CATEGORIES.map((cat) => {
        const items = achievements.filter((a) => a.category === cat);
        return { cat, count: items.length };
    });

    return (
        <>
            <div className="admin-layout">
                <AdminSidebar onLogout={() => setShowLogout(true)} />

                <div className="admin-main">
                    {/* Top Bar */}
                    <header className="admin-topbar">
                        <div className="admin-topbar-left">
                            <div className="admin-page-title">Manage Achievements</div>
                            <div className="admin-page-sub">Add, remove and monitor the achievements system</div>
                        </div>
                        <div className="admin-topbar-right">
                            <button
                                className="rules-save-btn"
                                onClick={() => { setForm(BLANK_FORM); setShowAddModal(true); }}
                                style={{ padding: '7px 18px', fontSize: 13, marginRight: 12 }}
                            >
                                + Add Achievement
                            </button>
                            <div className="admin-user-info">
                                <div className="admin-user-label">Admin User</div>
                                <div className="admin-user-email">{adminUser?.email}</div>
                            </div>
                            <div className="admin-avatar">{(adminUser?.email || 'A')[0].toUpperCase()}</div>
                        </div>
                    </header>

                    <div className="admin-body">
                        {/* Stats cards */}
                        <div className="admin-stats-row users-stats-row">
                            {[
                                { label: 'Total Achievements', val: achievements.length, icon: '🎖️', cls: 'blue' },
                                { label: 'Tracking',           val: achievements.filter(a=>a.category==='Tracking').length,    icon: '📊', cls: 'orange' },
                                { label: 'Activity',           val: achievements.filter(a=>a.category==='Activity').length,    icon: '⚡', cls: 'green' },
                                { label: 'Health',             val: achievements.filter(a=>a.category==='Health').length,      icon: '🩺', cls: 'pink' },
                            ].map((s) => (
                                <div className={`ach-stat-card ${s.cls}`} key={s.label}>
                                    <div className="ach-stat-icon">{s.icon}</div>
                                    <div className="ach-stat-body">
                                        <div className="ach-stat-val">{loading ? '…' : s.val}</div>
                                        <div className="ach-stat-label">{s.label}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Category breakdown */}
                        <div className="admin-users-full-card">
                            <div className="admin-card-title">Achievements by Category</div>
                            <div className="ach-category-grid">
                                {catStats.map((cs) => (
                                    <div className="ach-cat-card" key={cs.cat}>
                                        <div className="ach-cat-header">
                                            <span className="ach-cat-name">{cs.cat}</span>
                                            <span className="ach-cat-count">{cs.count} achievements</span>
                                        </div>
                                        <div className="admin-feature-bar-track" style={{ height: 6 }}>
                                            <div
                                                className="admin-feature-bar-fill"
                                                style={{ width: achievements.length > 0 ? `${(cs.count / achievements.length) * 100}%` : '0%', background: CAT_COLOR[cs.cat]?.bar }}
                                            />
                                        </div>
                                        <div className="ach-cat-pct">{achievements.length > 0 ? Math.round((cs.count / achievements.length) * 100) : 0}% of total</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Achievements Table */}
                        <div className="admin-users-full-card">
                            <div className="admin-card-title-row">
                                <div className="admin-card-title">All Achievements</div>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <select
                                        className="admin-filter-select"
                                        value={categoryFilter}
                                        onChange={(e) => setCategoryFilter(e.target.value)}
                                    >
                                        <option value="All">All Categories</option>
                                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                    <button
                                        className="rules-save-btn"
                                        onClick={() => { setForm(BLANK_FORM); setShowAddModal(true); }}
                                        style={{ padding: '6px 14px', fontSize: 12 }}
                                    >
                                        + Add New
                                    </button>
                                </div>
                            </div>

                            {loading ? (
                                <div className="admin-loading">Loading achievements…</div>
                            ) : filtered.length === 0 ? (
                                <div className="admin-empty">No achievements found. Click "+ Add Achievement" to create one.</div>
                            ) : (
                                <table className="admin-users-table full-table">
                                    <thead>
                                        <tr>
                                            <th>Achievement</th>
                                            <th>Category</th>
                                            <th>Requirement</th>
                                            <th style={{ textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((ach) => {
                                            const cc = CAT_COLOR[ach.category] || CAT_COLOR.Tracking;
                                            return (
                                                <tr key={ach.id}>
                                                    <td>
                                                        <div className="admin-user-cell">
                                                            <span className="ach-icon">{ach.icon}</span>
                                                            <div>
                                                                <div className="admin-user-name-cell">{ach.title}</div>
                                                                <div className="admin-email-cell">{ach.desc}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <span className="admin-status-badge" style={{ background: cc.pill, color: cc.text }}>
                                                            {ach.category}
                                                        </span>
                                                    </td>
                                                    <td className="admin-login-cell">{Number(ach.total).toLocaleString()}</td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button
                                                            onClick={() => setShowDeleteId(ach.id)}
                                                            style={{
                                                                background: '#FEE2E2', color: '#DC2626',
                                                                border: 'none', borderRadius: 6,
                                                                padding: '5px 12px', fontSize: 12,
                                                                fontWeight: 600, cursor: 'pointer',
                                                                transition: 'background 0.15s',
                                                            }}
                                                            title="Remove this achievement"
                                                        >
                                                            🗑️ Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                            <div className="admin-table-footer">
                                Showing {filtered.length} of {achievements.length} achievements
                            </div>
                        </div>

                        {/* Admin Actions */}
                        <div className="admin-users-full-card">
                            <div className="admin-card-title">Admin Actions</div>
                            <div className="ach-actions">
                                <button
                                    className="admin-btn-save"
                                    onClick={loadData}
                                    disabled={loading}
                                    style={{ background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}
                                >
                                    {loading ? '⏳ Loading…' : '🔄 Refresh Data'}
                                </button>
                                <div className="ach-reset-section">
                                    <div className="ach-reset-warning">
                                        ⚠️ <strong>Reset All Achievements</strong>
                                        <div className="ach-reset-desc">Clears all earned achievement progress for every user. Cannot be undone.</div>
                                    </div>
                                    <button className="ach-reset-btn" onClick={() => setShowReset(true)}>Reset Progress</button>
                                </div>
                                {msg && <div className={`admin-save-msg ${msg.startsWith('❌') ? 'error' : ''}`}>{msg}</div>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Add Achievement Modal ── */}
            {showAddModal && (
                <div className="logout-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="logout-dialog" style={{ maxWidth: 500, width: '95%' }} onClick={(e) => e.stopPropagation()}>
                        <div className="logout-dialog-icon">🏅</div>
                        <div className="logout-dialog-title">Add New Achievement</div>
                        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16, textAlign: 'left' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 10 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Title *</label>
                                    <input
                                        required
                                        value={form.title}
                                        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                                        placeholder="e.g. Step Master"
                                        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Icon</label>
                                    <input
                                        value={form.icon}
                                        onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                                        placeholder="🏅"
                                        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 18, textAlign: 'center', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Description *</label>
                                <input
                                    required
                                    value={form.desc}
                                    onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))}
                                    placeholder="e.g. Achieve 10,000 steps on 30 days"
                                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                                />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Category</label>
                                    <select
                                        value={form.category}
                                        onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                                        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                                    >
                                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Requirement (count)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        required
                                        value={form.total}
                                        onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
                                        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                                <button type="button" className="logout-btn-cancel" onClick={() => setShowAddModal(false)}>Cancel</button>
                                <button type="submit" className="logout-btn-confirm" disabled={saving}>
                                    {saving ? 'Saving…' : '✅ Add Achievement'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Delete Confirmation ── */}
            {showDeleteId && (
                <div className="logout-overlay" onClick={() => setShowDeleteId(null)}>
                    <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="logout-dialog-icon">🗑️</div>
                        <div className="logout-dialog-title">Remove Achievement?</div>
                        <div className="logout-dialog-msg">
                            This achievement will be permanently deleted. Users who earned it will no longer see it.
                        </div>
                        <div className="logout-dialog-actions">
                            <button className="logout-btn-cancel" onClick={() => setShowDeleteId(null)}>Cancel</button>
                            <button className="logout-btn-confirm" onClick={() => handleDelete(showDeleteId)}>Yes, Remove</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Reset Confirmation ── */}
            {showReset && (
                <div className="logout-overlay" onClick={() => setShowReset(false)}>
                    <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="logout-dialog-icon">⚠️</div>
                        <div className="logout-dialog-title">Reset All Progress?</div>
                        <div className="logout-dialog-msg">This will erase all streak data and progress for every user. <strong>Cannot be undone.</strong></div>
                        <div className="logout-dialog-actions">
                            <button className="logout-btn-cancel" onClick={() => setShowReset(false)}>Cancel</button>
                            <button className="logout-btn-confirm" onClick={handleReset}>Yes, Reset All</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Logout Dialog ── */}
            {showLogout && (
                <div className="logout-overlay" onClick={() => setShowLogout(false)}>
                    <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="logout-dialog-icon">🚪</div>
                        <div className="logout-dialog-title">Log Out?</div>
                        <div className="logout-dialog-msg">Are you sure you want to log out of the Admin Console?</div>
                        <div className="logout-dialog-actions">
                            <button className="logout-btn-cancel" onClick={() => setShowLogout(false)}>Cancel</button>
                            <button className="logout-btn-confirm" onClick={async () => { await signOut(auth); navigate('/login'); }}>Yes, Log Out</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
