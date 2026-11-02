import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import Sidebar from '../components/Sidebar';
import TopHeader from '../components/TopHeader';
import useNotifications from '../hooks/useNotifications';
import '../dashboard.css';
import '../profile.css';

/* ── Toast Notification Component ──────────────────────── */
function ToastContainer({ toasts, onDismiss }) {
    return (
        <div className="toast-container" aria-live="polite" aria-atomic="false">
            {toasts.map((t) => (
                <div
                    key={t.id}
                    className={`toast toast-${t.type} ${t.exiting ? 'toast-exit' : 'toast-enter'}`}
                    role="alert"
                >
                    <span className="toast-icon">{t.icon}</span>
                    <div className="toast-body">
                        <div className="toast-title">{t.title}</div>
                        {t.desc && <div className="toast-desc">{t.desc}</div>}
                    </div>
                    <button
                        className="toast-close"
                        onClick={() => onDismiss(t.id)}
                        aria-label="Dismiss"
                    >✕</button>
                    <div className="toast-progress" style={{ animationDuration: `${t.duration}ms` }} />
                </div>
            ))}
        </div>
    );
}

/* ── useToast hook ─────────────────────────────────────── */
function useToast() {
    const [toasts, setToasts] = useState([]);
    const timersRef = useRef({});

    const dismiss = useCallback((id) => {
        setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 350);
    }, []);

    const showToast = useCallback(({ type = 'success', icon, title, desc, duration = 4000 }) => {
        const id = Date.now() + Math.random();
        setToasts((prev) => [...prev, { id, type, icon, title, desc, duration, exiting: false }]);
        if (timersRef.current[id]) clearTimeout(timersRef.current[id]);
        timersRef.current[id] = setTimeout(() => dismiss(id), duration);
        return id;
    }, [dismiss]);

    return { toasts, showToast, dismiss };
}

const AGE_GROUPS = ['Under 18', '18–24', '25–34', '35–44', '45–54', '55–64', '65+'];
const GENDERS = ['Prefer not to say', 'Male', 'Female'];

// ── Compute BMI ───────────────────────────────────
function calcBMI(height, weight) {
    const h = Number(height); const w = Number(weight);
    if (!h || !w || h <= 0) return null;
    return w / ((h / 100) ** 2);
}
function bmiCategory(bmi) {
    if (bmi < 18.5) return { label: 'Underweight', color: '#3B82F6' };
    if (bmi < 23)   return { label: 'Normal', color: '#10B981' };      // Asian cutoff
    if (bmi < 27.5) return { label: 'Overweight', color: '#F59E0B' };  // Asian cutoff
    return               { label: 'Obese', color: '#EF4444' };
}

const RISK_FACTORS = [
    { id: 'familyHistory',   label: 'Family history of diabetes' },
    { id: 'overweight',      label: 'Overweight or obesity' },
    { id: 'sedentary',       label: 'Sedentary lifestyle' },
    { id: 'highBP',          label: 'High blood pressure' },
    { id: 'highCholesterol', label: 'High cholesterol' },
    { id: 'gestational',     label: 'Previous gestational diabetes' },
    { id: 'other',           label: 'Other' },
];

const REMINDERS = [
    { id: 'dailyRecord', label: 'Daily record reminder', desc: 'Get notified to log your daily data' },
    { id: 'weeklyProgress', label: 'Weekly progress review', desc: 'Receive your weekly summary report' },
    { id: 'medication', label: 'Medication reminder', desc: 'Remind you to take medications' },
    { id: 'activity', label: 'Activity reminder', desc: 'Motivate you to stay active' },
];

export default function Profile() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [editMode, setEditMode] = useState(false);
    const [notifPermission, setNotifPermission] = useState(
        'Notification' in window ? Notification.permission : 'unsupported'
    );

    // Toast system
    const { toasts, showToast, dismiss } = useToast();

    // Saved (displayed) profile
    const [profile, setProfile] = useState({
        fullName: '', email: '', phone: '', ageGroup: '', gender: '',
        height: '', weight: '', targetWeight: '', riskFactors: {},
        dateOfBirth: '', otherRiskFactor: '',
    });

    // Draft — only used while editing
    const [draft, setDraft] = useState(null);

    const [savingProfile, setSavingProfile] = useState(false);
    const [profileMsg, setProfileMsg] = useState('');

    // Reminder state — declared BEFORE useNotifications so the hook can read them
    const [reminders, setReminders] = useState({
        dailyRecord: true, weeklyProgress: true, medication: false, activity: true,
    });
    const [timePreference, setTimePreference] = useState('morning');
    const [customTime, setCustomTime]           = useState('09:00'); // HH:MM for custom mode
    const [savingReminders, setSavingReminders] = useState(false);
    const [reminderMsg, setReminderMsg]         = useState('');

    // Test notification feedback
    const [testState, setTestState] = useState('idle'); // idle | sending | sent | error

    // Activate notifications with current reminder settings
    const { requestPermission, sendTestNotification } = useNotifications(reminders, timePreference, true, customTime);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) { navigate('/login'); return; }
            setUser(u);
            const base = { email: u.email || '', fullName: u.displayName || '' };
            setProfile((p) => ({ ...p, ...base }));
            try {
                const snap = await getDoc(doc(db, 'users', u.uid));
                if (snap.exists()) {
                    const d = snap.data();
                    const loaded = {
                        fullName: d.fullName || u.displayName || '',
                        email: d.email || u.email || '',
                        phone: d.phone || '',
                        ageGroup: d.ageGroup || '',
                        gender: d.gender || '',
                        height: d.height || '',
                        weight: d.weight || '',
                        targetWeight: d.targetWeight || '',
                        riskFactors: d.riskFactors || {},
                        dateOfBirth: d.dateOfBirth || '',
                        otherRiskFactor: d.otherRiskFactor || '',
                    };
                    setProfile(loaded);
                    if (d.reminders) setReminders(d.reminders);
                    if (d.timePreference) setTimePreference(d.timePreference);
                    if (d.customTime) setCustomTime(d.customTime);
                }
            } catch { /* use defaults */ }
        });
        return () => unsub();
    }, [navigate]);

    /* ── Edit helpers ─────────────────────────────────────── */
    const startEdit = () => { setDraft({ ...profile }); setEditMode(true); setProfileMsg(''); };
    const cancelEdit = () => { setDraft(null); setEditMode(false); setProfileMsg(''); };

    const setDraftField = (field) => (e) =>
        setDraft((d) => ({ ...d, [field]: e.target.value }));

    const toggleDraftRisk = (id) =>
        setDraft((d) => ({
            ...d,
            riskFactors: { ...d.riskFactors, [id]: !d.riskFactors[id] },
        }));

    const handleSaveProfile = async (e) => {
        e.preventDefault();
        setSavingProfile(true); setProfileMsg('');
        try {
            await updateProfile(user, { displayName: draft.fullName });
            await setDoc(doc(db, 'users', user.uid), {
                fullName: draft.fullName,
                phone: draft.phone,
                ageGroup: draft.ageGroup,
                gender: draft.gender,
                dateOfBirth: draft.dateOfBirth || null,
                height: draft.height ? Number(draft.height) : null,
                weight: draft.weight ? Number(draft.weight) : null,
                targetWeight: draft.targetWeight ? Number(draft.targetWeight) : null,
                riskFactors: draft.riskFactors,
                otherRiskFactor: draft.riskFactors.other ? (draft.otherRiskFactor?.trim() || '') : '',
                updatedAt: serverTimestamp(),
            }, { merge: true });
            setProfile({ ...draft });
            setProfileMsg('✅ Profile saved successfully!');
            // Show in-app toast
            showToast({
                type: 'success',
                icon: '👤',
                title: 'Profile updated!',
                desc: 'Your personal information has been saved successfully.',
                duration: 4500,
            });
            setTimeout(() => { setEditMode(false); setDraft(null); setProfileMsg(''); }, 1200);
        } catch (err) {
            setProfileMsg('❌ Error: ' + err.message);
            showToast({
                type: 'error',
                icon: '❌',
                title: 'Save failed',
                desc: err.message,
                duration: 5000,
            });
        } finally {
            setSavingProfile(false);
        }
    };

    const toggleReminder = (id) => setReminders((r) => ({ ...r, [id]: !r[id] }));

    const handleSaveReminders = async (e) => {
        e.preventDefault();
        setSavingReminders(true); setReminderMsg('');
        try {
            await setDoc(doc(db, 'users', user.uid), {
                reminders, timePreference, customTime, updatedAt: serverTimestamp(),
            }, { merge: true });
            setReminderMsg('✅ Reminder settings saved!');

            // Clear today's "already-fired" cache so the new time is honoured
            // (without this, changing the time on the same day would be silently skipped)
            const todayKey = new Date().toISOString().slice(0, 10);
            ['dailyRecord', 'weeklyProgress', 'medication', 'activity'].forEach(k => {
                localStorage.removeItem(`insuletrack-notif-${k}-${todayKey}`);
            });

            // Build human-readable time label
            const activeCount = Object.values(reminders).filter(Boolean).length;
            const fmtCustom = (() => {
                if (!customTime) return 'Custom time';
                const [h, m] = customTime.split(':').map(Number);
                const ampm = h >= 12 ? 'PM' : 'AM';
                const h12  = h % 12 || 12;
                return `Custom — ${h12}:${String(m).padStart(2,'0')} ${ampm}`;
            })();
            const timeLabelMap = {
                morning: 'Morning (6:00 AM)',
                evening: 'Evening (5:00 PM)',
                custom:  fmtCustom,
            };

            // In-app toast
            showToast({
                type: 'success',
                icon: '🔔',
                title: 'Reminder settings saved!',
                desc: `${activeCount} reminder${activeCount !== 1 ? 's' : ''} active · ${timeLabelMap[timePreference] ?? timePreference}`,
                duration: 5000,
            });

            // Also fire a real OS browser notification if permission granted
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                try {
                    const n = new Notification('🔔 InsuleTrack — Reminders Updated', {
                        body: `${activeCount} reminder${activeCount !== 1 ? 's' : ''} active · ${timeLabelMap[timePreference]}.`,
                        icon: '/favicon.ico',
                        tag: 'insuletrack-reminders-saved',
                    });
                    setTimeout(() => n.close(), 7000);
                } catch { /* ignore */ }
            }
        } catch (err) {
            setReminderMsg('❌ Error: ' + err.message);
            showToast({
                type: 'error',
                icon: '❌',
                title: 'Could not save reminders',
                desc: err.message,
                duration: 5000,
            });
        } finally {
            setSavingReminders(false);
        }
    };

    const initials = (profile.fullName || 'U')
        .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

    /* ── View-mode row helper ─────────────────────────────── */
    const InfoRow = ({ label, value, placeholder = '—' }) => (
        <div className="prof-info-row">
            <span className="prof-info-label">{label}</span>
            <span className={`prof-info-value${!value ? ' empty' : ''}`}>
                {value || placeholder}
            </span>
        </div>
    );

    const activeRisks = RISK_FACTORS.filter((rf) => profile.riskFactors[rf.id]);

    return (
        <div className="db-layout">
            <ToastContainer toasts={toasts} onDismiss={dismiss} />
            <Sidebar />

            <div className="db-main">
                <TopHeader user={user} profile={profile} />

                <div className="db-body">
                    {/* Title */}
                    <div>
                        <div className="db-page-title">Profile &amp; Settings</div>
                        <div className="db-page-sub">Manage your personal information and notification preferences</div>
                    </div>

                    {/* ── Profile Avatar Card ── */}
                    <div className="prof-avatar-card">
                        <div className="prof-avatar-circle">{initials}</div>
                        <div className="prof-avatar-info">
                            <div className="prof-avatar-name">{profile.fullName || 'Your Name'}</div>
                            <div className="prof-avatar-email">{profile.email}</div>
                            {profile.ageGroup && (
                                <div className="prof-avatar-tags">
                                    {profile.ageGroup && <span className="prof-tag">{profile.ageGroup}</span>}
                                    {profile.gender && <span className="prof-tag">{profile.gender}</span>}
                                </div>
                            )}
                        </div>
                        {!editMode && (
                            <button className="prof-edit-btn" onClick={startEdit}>
                                ✏️ Edit Profile
                            </button>
                        )}
                    </div>

                    {/* ── Notification Permission Card ── */}
                    <div className={`notif-permission-card ${notifPermission === 'granted' ? 'granted' : notifPermission === 'denied' ? 'denied' : ''}`}>
                        <div className="notif-permission-left">
                            <div className="notif-permission-icon">
                                {notifPermission === 'granted' ? '🔔' : notifPermission === 'denied' ? '🔕' : '🔔'}
                            </div>
                            <div>
                                <div className="notif-permission-title">
                                    {notifPermission === 'granted' && 'Notifications Active'}
                                    {notifPermission === 'denied' && 'Notifications Blocked'}
                                    {notifPermission === 'default' && 'Enable Notifications'}
                                    {notifPermission === 'unsupported' && 'Notifications Not Supported'}
                                </div>
                                <div className="notif-permission-desc">
                                    {notifPermission === 'granted' && 'You will receive reminders and health alerts based on your settings below.'}
                                    {notifPermission === 'denied' && 'Notifications are blocked. Enable them in your browser settings to receive reminders.'}
                                    {notifPermission === 'default' && 'Allow notifications to receive daily reminders, medication alerts, and weekly health reports.'}
                                    {notifPermission === 'unsupported' && 'Your browser does not support push notifications.'}
                                </div>
                            </div>
                        </div>
                        <div className="notif-permission-actions">
                            {notifPermission === 'granted' && (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                                    <button
                                        className="notif-test-btn"
                                        disabled={testState === 'sending'}
                                        onClick={async () => {
                                            setTestState('sending');
                                            try {
                                                await sendTestNotification();
                                                setTestState('sent');
                                            } catch {
                                                setTestState('error');
                                            } finally {
                                                setTimeout(() => setTestState('idle'), 4000);
                                            }
                                        }}
                                        type="button"
                                        style={testState === 'sending' ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
                                    >
                                        {testState === 'sending' && '⏳ Sending...'}
                                        {testState === 'sent'    && '✅ Sent! Check your OS tray'}
                                        {testState === 'error'   && '❌ Failed — check console'}
                                        {testState === 'idle'    && '🔔 Test notification'}
                                    </button>
                                    {testState === 'sent' && (
                                        <span style={{ fontSize: 11, color: '#059669' }}>
                                            Look in the bottom-right corner or OS notification tray
                                        </span>
                                    )}
                                </div>
                            )}
                            {notifPermission === 'default' && (
                                <button
                                    className="notif-enable-btn"
                                    type="button"
                                    onClick={async () => {
                                        const result = await requestPermission();
                                        setNotifPermission(result);
                                    }}
                                >
                                    Enable notifications
                                </button>
                            )}
                            {notifPermission === 'denied' && (
                                <span className="notif-denied-hint">
                                    Open browser settings → Site permissions → Allow
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="prof-layout">
                        {/* ── LEFT: Profile Information ── */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                            {/* ── VIEW MODE ── */}
                            {!editMode && (
                                <div className="prof-card">
                                    <div className="prof-card-header">
                                        <div className="prof-card-icon blue">👤</div>
                                        <div style={{ flex: 1 }}>
                                            <div className="prof-card-title">Profile Information</div>
                                            <div className="prof-card-sub">Your personal details</div>
                                        </div>
                                    </div>

                                    <div className="prof-info-section">
                                        <div className="prof-section-label">👤 Personal Details</div>
                                        <InfoRow label="Full Name" value={profile.fullName} />
                                        <InfoRow label="Email" value={profile.email} />
                                        <InfoRow label="Phone" value={profile.phone} placeholder="Not set" />
                                        <InfoRow label="Date of Birth" value={profile.dateOfBirth || ''} placeholder="Not set" />
                                        <InfoRow label="Age Group" value={profile.ageGroup} placeholder="Not set" />
                                        <InfoRow label="Gender" value={profile.gender} placeholder="Not set" />
                                    </div>

                                    <div className="prof-divider" />

                                    <div className="prof-info-section">
                                        <div className="prof-section-label">⚖️ Physical Measurements</div>
                                        <InfoRow label="Height" value={profile.height ? `${profile.height} cm` : ''} placeholder="Not set" />
                                        <InfoRow label="Current Weight" value={profile.weight ? `${profile.weight} kg` : ''} placeholder="Not set" />
                                        <InfoRow label="Target Weight" value={profile.targetWeight ? `${profile.targetWeight} kg` : ''} placeholder="Not set" />
                                        {/* BMI computed display */}
                                        {(() => {
                                            const bmi = calcBMI(profile.height, profile.weight);
                                            if (!bmi) return null;
                                            const cat = bmiCategory(bmi);
                                            return (
                                                <div className="prof-info-row">
                                                    <span className="prof-info-label">BMI</span>
                                                    <span className="prof-bmi-badge" style={{ background: cat.color + '18', color: cat.color, border: `1.5px solid ${cat.color}40` }}>
                                                        {bmi.toFixed(1)} — {cat.label}
                                                    </span>
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    <div className="prof-divider" />

                                    <div className="prof-info-section">
                                        <div className="prof-section-label">⚠️ Risk Factors</div>
                                        {activeRisks.length > 0 ? (
                                            <div className="prof-risk-tags">
                                                {activeRisks.map((rf) => (
                                                    <span key={rf.id} className="prof-risk-tag">
                                                        {rf.id === 'other' && profile.otherRiskFactor
                                                            ? profile.otherRiskFactor
                                                            : rf.label}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="prof-info-value empty">No risk factors selected</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ── EDIT MODE ── */}
                            {editMode && draft && (
                                <form className="prof-card" onSubmit={handleSaveProfile}>
                                    <div className="prof-card-header">
                                        <div className="prof-card-icon blue">✏️</div>
                                        <div style={{ flex: 1 }}>
                                            <div className="prof-card-title">Edit Profile</div>
                                            <div className="prof-card-sub">Update your personal details</div>
                                        </div>
                                        <button
                                            type="button"
                                            className="prof-cancel-btn"
                                            onClick={cancelEdit}
                                        >
                                            ✕ Cancel
                                        </button>
                                    </div>

                                    {/* Full Name */}
                                    <div className="rec-field-group">
                                        <label className="rec-label">Full Name</label>
                                        <input type="text" className="rec-input"
                                            value={draft.fullName} onChange={setDraftField('fullName')}
                                            placeholder="Your full name" />
                                    </div>

                                    {/* Email (read-only) + Phone */}
                                    <div className="prof-grid-2">
                                        <div className="rec-field-group">
                                            <label className="rec-label">Email Address</label>
                                            <input type="email" className="rec-input"
                                                value={draft.email} readOnly
                                                style={{ background: '#F9FAFB', color: '#9CA3AF', cursor: 'not-allowed' }} />
                                            <div className="rec-hint">Email cannot be changed</div>
                                        </div>
                                        <div className="rec-field-group">
                                            <label className="rec-label">Phone Number</label>
                                            <input type="tel" className="rec-input"
                                                value={draft.phone} onChange={setDraftField('phone')}
                                                placeholder="+012 345 6789" />
                                        </div>
                                    </div>

                                    {/* Age Group + Gender + DOB */}
                                    <div className="prof-grid-2">
                                        <div className="rec-field-group">
                                            <label className="rec-label">Date of Birth</label>
                                            <input type="date" className="rec-input"
                                                value={draft.dateOfBirth || ''}
                                                onChange={setDraftField('dateOfBirth')}
                                                max={new Date().toISOString().slice(0, 10)} />
                                            <div className="rec-hint">Used to improve diabetes risk accuracy</div>
                                        </div>
                                        <div className="rec-field-group">
                                            <label className="rec-label">Gender</label>
                                            <select className="rec-input rec-select"
                                                value={draft.gender} onChange={setDraftField('gender')}>
                                                <option value="">Select gender</option>
                                                {GENDERS.map((g) => <option key={g}>{g}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="prof-grid-2">
                                        <div className="rec-field-group">
                                            <label className="rec-label">Age Group</label>
                                            <select className="rec-input rec-select"
                                                value={draft.ageGroup} onChange={setDraftField('ageGroup')}>
                                                <option value="">Select age group</option>
                                                {AGE_GROUPS.map((a) => <option key={a}>{a}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="prof-divider" />

                                    {/* Physical Measurements */}
                                    <div className="prof-section-label">⚖️ Physical Measurements</div>
                                    <div className="prof-grid-3">
                                        <div className="rec-field-group">
                                            <label className="rec-label">Height (cm)</label>
                                            <input type="number" className="rec-input"
                                                value={draft.height} onChange={setDraftField('height')}
                                                placeholder="175" min="50" max="250" />
                                        </div>
                                        <div className="rec-field-group">
                                            <label className="rec-label">Current Weight (kg)</label>
                                            <input type="number" className="rec-input"
                                                value={draft.weight} onChange={setDraftField('weight')}
                                                placeholder="72.5" min="20" max="300" step="0.1" />
                                        </div>
                                        <div className="rec-field-group">
                                            <label className="rec-label">Target Weight (kg)</label>
                                            <input type="number" className="rec-input"
                                                value={draft.targetWeight} onChange={setDraftField('targetWeight')}
                                                placeholder="66.0" min="20" max="300" step="0.1" />
                                        </div>
                                    </div>

                                    <div className="prof-divider" />

                                    {/* Risk Factors — checkboxes + optional Other text */}
                                    <div className="prof-section-label">⚠️ Risk Factors</div>
                                    <div className="risk-factors-grid">
                                        {RISK_FACTORS.map((rf) => (
                                            <label key={rf.id} className="risk-item">
                                                <input
                                                    type="checkbox"
                                                    className="risk-checkbox"
                                                    checked={!!draft.riskFactors[rf.id]}
                                                    onChange={() => toggleDraftRisk(rf.id)}
                                                />
                                                <span className="risk-label">{rf.label}</span>
                                            </label>
                                        ))}
                                    </div>

                                    {/* Free-text slides in when 'Other' is checked */}
                                    {draft.riskFactors.other && (
                                        <div style={{ marginTop: 10 }}>
                                            <input
                                                type="text"
                                                className="rec-input"
                                                placeholder="e.g., Polycystic ovary syndrome, Chronic stress, Sleep apnea…"
                                                value={draft.otherRiskFactor || ''}
                                                onChange={setDraftField('otherRiskFactor')}
                                                maxLength={120}
                                                autoFocus
                                            />
                                            <div className="rec-hint">Please describe your other risk factor</div>
                                        </div>
                                    )}

                                    <div className="rec-hint" style={{ marginTop: 8 }}>
                                        Select any factors that apply to you.
                                    </div>

                                    {/* Feedback */}
                                    {profileMsg && (
                                        <div className={profileMsg.startsWith('✅') ? 'success-msg' : 'error-msg'}>
                                            {profileMsg}
                                        </div>
                                    )}

                                    {/* Action buttons */}
                                    <div className="prof-edit-actions">
                                        <button type="button" className="prof-cancel-btn-lg" onClick={cancelEdit}>
                                            Cancel
                                        </button>
                                        <button type="submit" className="btn-primary" disabled={savingProfile}
                                            style={{ flex: 1 }}>
                                            {savingProfile ? <span className="spinner" /> : '💾 Save Changes'}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>

                        {/* ── RIGHT: Reminder Settings ── */}
                        <div>
                            <form className="prof-card" onSubmit={handleSaveReminders}>
                                <div className="prof-card-header">
                                    <div className="prof-card-icon orange">🔔</div>
                                    <div>
                                        <div className="prof-card-title">Reminder Settings</div>
                                        <div className="prof-card-sub">Manage your notification preferences</div>
                                    </div>
                                </div>

                                <div className="reminder-list">
                                    {REMINDERS.map((r) => (
                                        <div key={r.id} className="reminder-toggle-row">
                                            <div className="reminder-toggle-info">
                                                <div className="reminder-toggle-label">{r.label}</div>
                                                <div className="reminder-toggle-desc">{r.desc}</div>
                                            </div>
                                            <button
                                                type="button"
                                                className={`toggle-switch${reminders[r.id] ? ' on' : ''}`}
                                                onClick={() => toggleReminder(r.id)}
                                                aria-label={r.label}
                                            >
                                                <span className="toggle-thumb" />
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <div className="prof-divider" />

                                <div className="prof-section-label">⏰ Reminder Time Preference</div>
                                <div className="time-pref-list">
                                    {[
                                        { val: 'morning', label: 'Morning (6:00 AM – 12:00 PM)' },
                                        { val: 'evening', label: 'Evening (5:00 PM – 9:00 PM)' },
                                        { val: 'custom',  label: 'Custom time' },
                                    ].map((tp) => (
                                        <label key={tp.val} className="time-pref-item">
                                            <input
                                                type="radio"
                                                name="timePreference"
                                                value={tp.val}
                                                checked={timePreference === tp.val}
                                                onChange={() => setTimePreference(tp.val)}
                                                className="time-radio"
                                            />
                                            <span className="time-label">{tp.label}</span>
                                        </label>
                                    ))}
                                </div>

                                {/* ── Custom time picker (shown only when Custom is selected) ── */}
                                {timePreference === 'custom' && (
                                    <div className="custom-time-picker">
                                        <label className="custom-time-label" htmlFor="customTimePicker">
                                            🕐 Set your exact reminder time
                                        </label>
                                        <div className="custom-time-row">
                                            <input
                                                id="customTimePicker"
                                                type="time"
                                                className="custom-time-input"
                                                value={customTime}
                                                onChange={(e) => setCustomTime(e.target.value)}
                                            />
                                            <span className="custom-time-preview">
                                                {(() => {
                                                    if (!customTime) return '';
                                                    const [h, m] = customTime.split(':').map(Number);
                                                    const ampm = h >= 12 ? 'PM' : 'AM';
                                                    const h12  = h % 12 || 12;
                                                    return `You'll be reminded at ${h12}:${String(m).padStart(2,'0')} ${ampm}`;
                                                })()}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {reminderMsg && (
                                    <div className={reminderMsg.startsWith('✅') ? 'success-msg' : 'error-msg'}>
                                        {reminderMsg}
                                    </div>
                                )}

                                <button type="submit" className="btn-primary" disabled={savingReminders}>
                                    {savingReminders ? <span className="spinner" /> : '🔔 Save Reminder Settings'}
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
