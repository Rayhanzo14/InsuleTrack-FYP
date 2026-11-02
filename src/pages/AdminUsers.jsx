/**
 * AdminUsers.jsx
 *
 * Full Users Management page for the admin panel.
 * - Fetches all users from Firestore 'users' collection
 * - Shows stats: Total, Active, Inactive, New This Month
 * - Search bar + Status filter
 * - Table with avatar, name, email, status, blood type, registered, last login, records count
 * - View (modal) + Delete actions
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import {
    collection, getDocs, doc, getDoc, deleteDoc, query, orderBy,
} from 'firebase/firestore';
import AdminSidebar from '../components/AdminSidebar';
import './admin.css';

/* ── Helpers ── */
function relativeTime(ts) {
    if (!ts) return '—';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    const diffW = Math.floor(diffD / 7);
    return `${diffW}w ago`;
}

function formatDate(ts) {
    if (!ts) return '—';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(name, email) {
    const src = name || email || '?';
    return src.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

const AVATAR_COLORS = [
    '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B',
    '#EF4444', '#EC4899', '#06B6D4', '#14B8A6',
];

function avatarColor(uid) {
    let h = 0;
    for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) & 0xFFFF;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/* ── User Detail Modal ── */
function UserModal({ user, onClose }) {
    if (!user) return null;
    const initials = getInitials(user.fullName, user.email);
    const color = avatarColor(user.uid || '0');
    return (
        <div className="admin-modal-overlay" onClick={onClose}>
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                    <div className="admin-modal-avatar" style={{ background: color }}>
                        {initials}
                    </div>
                    <div>
                        <div className="admin-modal-name">{user.fullName || '—'}</div>
                        <div className="admin-modal-email">{user.email}</div>
                    </div>
                    <button className="admin-modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="admin-modal-body">
                    <div className="admin-modal-grid">
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Age Group</span>
                            <span className="admin-modal-val">{user.ageGroup || '—'}</span>
                        </div>
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Gender</span>
                            <span className="admin-modal-val">{user.gender || '—'}</span>
                        </div>
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Phone</span>
                            <span className="admin-modal-val">{user.phone || '—'}</span>
                        </div>
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Height</span>
                            <span className="admin-modal-val">{user.height ? `${user.height} cm` : '—'}</span>
                        </div>
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Weight</span>
                            <span className="admin-modal-val">{user.weight ? `${user.weight} kg` : '—'}</span>
                        </div>
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Target Weight</span>
                            <span className="admin-modal-val">{user.targetWeight ? `${user.targetWeight} kg` : '—'}</span>
                        </div>
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Registered</span>
                            <span className="admin-modal-val">{formatDate(user.createdAt)}</span>
                        </div>
                        <div className="admin-modal-field">
                            <span className="admin-modal-label">Last Updated</span>
                            <span className="admin-modal-val">{formatDate(user.updatedAt)}</span>
                        </div>
                    </div>

                    {/* Risk Factors */}
                    {user.riskFactors && Object.keys(user.riskFactors).some((k) => user.riskFactors[k]) && (
                        <div className="admin-modal-risks">
                            <div className="admin-modal-label" style={{ marginBottom: 8 }}>Risk Factors</div>
                            <div className="admin-modal-risk-tags">
                                {Object.entries(user.riskFactors)
                                    .filter(([, v]) => v)
                                    .map(([k]) => (
                                        <span key={k} className="admin-risk-tag">{k}</span>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="admin-modal-footer">
                    <button className="admin-btn-reset" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}

/* ── Delete Confirm Dialog ── */
function DeleteDialog({ user, onConfirm, onCancel }) {
    if (!user) return null;
    return (
        <div className="logout-overlay" onClick={onCancel}>
            <div className="logout-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="logout-dialog-icon">🗑️</div>
                <div className="logout-dialog-title">Delete User?</div>
                <div className="logout-dialog-msg">
                    Remove <strong>{user.fullName || user.email}</strong> from InsuleTrack?
                    This cannot be undone.
                </div>
                <div className="logout-dialog-actions">
                    <button className="logout-btn-cancel" onClick={onCancel}>Cancel</button>
                    <button className="logout-btn-confirm" onClick={onConfirm}>
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ── Main Component ── */
export default function AdminUsers() {
    const navigate = useNavigate();
    const [adminUser, setAdminUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [viewUser, setViewUser] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [_deleting, setDeleting] = useState(false);
    const [showLogout, setShowLogout] = useState(false);

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    /* ── Fetch users ── */
    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const snap = await getDocs(
                query(collection(db, 'users'), orderBy('createdAt', 'desc'))
            );
            setUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
        } catch {
            const snap = await getDocs(collection(db, 'users'));
            setUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
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
            fetchUsers();
        });
        return () => unsub();
    }, [navigate, fetchUsers]);

    /* ── Stats ── */
    const totalCount = users.length;
    const activeCount = users.filter((u) => {
        const ts = u.lastLogin || u.updatedAt || u.createdAt;
        if (!ts) return false;
        return (ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime()) >= sevenDaysAgo;
    }).length;
    const inactiveCount = totalCount - activeCount;
    const newThisMonth = users.filter((u) => {
        const ts = u.createdAt;
        if (!ts) return false;
        return (ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime()) >= thirtyDaysAgo;
    }).length;

    /* ── Filtering ── */
    const filtered = users.filter((u) => {
        const q = search.toLowerCase();
        const matchSearch =
            !q ||
            (u.fullName || '').toLowerCase().includes(q) ||
            (u.email || '').toLowerCase().includes(q);
        const ts = u.lastLogin || u.updatedAt || u.createdAt;
        const ms = ts?.toDate ? ts.toDate().getTime() : ts ? new Date(ts).getTime() : 0;
        const isActive = ms >= sevenDaysAgo;
        const matchStatus =
            statusFilter === 'All' ||
            (statusFilter === 'Active' && isActive) ||
            (statusFilter === 'Inactive' && !isActive);
        return matchSearch && matchStatus;
    });

    /* ── Delete ── */
    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteDoc(doc(db, 'users', deleteTarget.uid));
            setUsers((prev) => prev.filter((u) => u.uid !== deleteTarget.uid));
        } catch (err) {
            alert('Delete failed: ' + err.message);
        } finally {
            setDeleting(false);
            setDeleteTarget(null);
        }
    };

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
                            <div className="admin-page-title">Users Management</div>
                            <div className="admin-page-sub">
                                View and manage all registered users
                            </div>
                        </div>
                        <div className="admin-topbar-right">
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
                        {/* ── Stats Row ── */}
                        <div className="admin-stats-row users-stats-row">
                            {[
                                { icon: '👥', label: 'Total Users', val: totalCount, color: 'blue' },
                                { icon: '✅', label: 'Active', val: activeCount, color: 'teal' },
                                { icon: '⏸️', label: 'Inactive', val: inactiveCount, color: 'orange' },
                                { icon: '🆕', label: 'New This Month', val: newThisMonth, color: 'purple' },
                            ].map((s) => (
                                <div className="admin-stat-card" key={s.label}>
                                    <div className={`admin-stat-icon ${s.color}`}>{s.icon}</div>
                                    <div className="admin-stat-body">
                                        <div className="admin-stat-label">{s.label}</div>
                                        <div className="admin-stat-val">
                                            {loading ? '…' : s.val}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* ── Search + Filter + Refresh ── */}
                        <div className="admin-users-toolbar">
                            <div className="admin-search-wrap">
                                <span className="admin-search-icon">🔍</span>
                                <input
                                    className="admin-search-input"
                                    type="text"
                                    placeholder="Search by name or email…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                            <select
                                className="admin-filter-select"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                            >
                                <option>All</option>
                                <option>Active</option>
                                <option>Inactive</option>
                            </select>
                            <button
                                className="admin-refresh-btn"
                                onClick={fetchUsers}
                                title="Refresh"
                            >
                                ↻ Refresh
                            </button>
                        </div>

                        {/* ── Users Table ── */}
                        <div className="admin-users-full-card">
                            {loading ? (
                                <div className="admin-loading">Loading users…</div>
                            ) : filtered.length === 0 ? (
                                <div className="admin-empty">
                                    {users.length === 0
                                        ? 'No registered users yet.'
                                        : 'No users match your search.'}
                                </div>
                            ) : (
                                <>
                                    <table className="admin-users-table full-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>User</th>
                                                <th>Age Group</th>
                                                <th>Gender</th>
                                                <th>Status</th>
                                                <th>Weight&nbsp;(kg)</th>
                                                <th>Registered</th>
                                                <th>Last Updated</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filtered.map((u, i) => {
                                                const ts = u.lastLogin || u.updatedAt || u.createdAt;
                                                const ms = ts?.toDate
                                                    ? ts.toDate().getTime()
                                                    : ts ? new Date(ts).getTime() : 0;
                                                const isActive = ms >= sevenDaysAgo;
                                                const color = avatarColor(u.uid);
                                                const initials = getInitials(u.fullName, u.email);
                                                return (
                                                    <tr key={u.uid}>
                                                        <td className="admin-login-cell">{i + 1}</td>
                                                        <td>
                                                            <div className="admin-user-cell">
                                                                <div
                                                                    className="admin-table-avatar"
                                                                    style={{ background: color }}
                                                                >
                                                                    {initials}
                                                                </div>
                                                                <div>
                                                                    <div className="admin-user-name-cell">
                                                                        {u.fullName || '—'}
                                                                    </div>
                                                                    <div className="admin-email-cell">
                                                                        {u.email}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="admin-login-cell">{u.ageGroup || '—'}</td>
                                                        <td className="admin-login-cell">{u.gender || '—'}</td>
                                                        <td>
                                                            <span className={`admin-status-badge ${isActive ? 'active' : 'inactive'}`}>
                                                                {isActive ? '● Active' : '● Inactive'}
                                                            </span>
                                                        </td>
                                                        <td className="admin-login-cell">
                                                            {u.weight || '—'}
                                                        </td>
                                                        <td className="admin-login-cell">
                                                            {formatDate(u.createdAt)}
                                                        </td>
                                                        <td className="admin-login-cell">
                                                            {relativeTime(u.lastLogin || u.updatedAt || u.createdAt)}
                                                        </td>
                                                        <td>
                                                            <div className="admin-actions-cell">
                                                                <button
                                                                    className="admin-view-btn"
                                                                    onClick={() => setViewUser(u)}
                                                                    title="View user details"
                                                                >
                                                                    👁 View
                                                                </button>
                                                                <button
                                                                    className="admin-delete-btn"
                                                                    onClick={() => setDeleteTarget(u)}
                                                                    title="Delete user"
                                                                >
                                                                    🗑
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    <div className="admin-table-footer">
                                        Showing {filtered.length} of {totalCount} users
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── User Detail Modal ── */}
            {viewUser && (
                <UserModal user={viewUser} onClose={() => setViewUser(null)} />
            )}

            {/* ── Delete Dialog ── */}
            {deleteTarget && (
                <DeleteDialog
                    user={deleteTarget}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteTarget(null)}
                />
            )}

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
