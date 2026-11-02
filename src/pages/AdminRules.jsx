/**
 * AdminRules.jsx – Rules and Settings page
 *
 * 4 settings sections:
 *  1. Health Threshold Rules   (sliders + number inputs)
 *  2. Risk Assessment Settings (threshold inputs + live band preview + read-only formula)
 *  3. Notification Settings    (toggles + time picker + day select)
 *  4. System Settings          (number inputs)
 *
 * Save All Settings → persists to Firestore 'adminSettings/rules' doc
 * Reset to Defaults → resets local state to defaults
 *
 * The lowRiskScore and highRiskScore thresholds are READ by useDiabetesRisk.js
 * to determine the four risk bands shown on each user's dashboard.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import AdminSidebar from '../components/AdminSidebar';
import './admin.css';

/* ── Default values ───────────────────────────────────── */
const DEFAULTS = {
    /* Health Thresholds */
    maxGlucose: 180,
    maxSugaryDrinks: 3,
    weightChangeAlert: 2.5,
    minFastingGlucose: 70,
    maxPostMealGlucose: 180,
    maxBMI: 23,             // WHO Asian-Pacific / Malaysia MOH: overweight ≥23 (not 25 for Asians)
    minActivityMinutes: 150,

    /* Risk Assessment
     * lowRiskScore  = Low → Moderate boundary (%)
     * highRiskScore = High → Very High boundary (%)
     * Moderate–High midpoint is derived as (low + high) / 2
     */
    lowRiskScore: 37,
    highRiskScore: 75,
    // Display-only: the actual formula used in src/hooks/useDiabetesRisk.js
    riskFormula: 'σ(−2.5 + 2.4·FastingGlucose + 2.8·HbA1c + 1.5·PostMealGlucose + 1.2·BMI − 1.2·Activity + 1.3·RiskFactors + 0.9·Age)',

    /* Notifications */
    emailNotifications: true,
    pushNotifications: true,
    reminderTime: '08:00',
    weeklyReportDay: 'Monday',

    /* System */
    maxPasswordDays: 90,
    maxLoginAttempts: 5,
    sessionTimeout: 30,
    maxReportSize: 10,
};

/* ── Toggle Switch ───────────────────────────────────── */
function Toggle({ value, onChange }) {
    return (
        <button
            type="button"
            className={`rules-toggle ${value ? 'on' : 'off'}`}
            onClick={() => onChange(!value)}
            aria-checked={value}
            role="switch"
        >
            <span className="rules-toggle-thumb" />
        </button>
    );
}

/* ── Slider with live fill ───────────────────────────── */
function RangeSlider({ value, min, max, step, onChange }) {
    const pct = ((value - min) / (max - min)) * 100;
    return (
        <input
            type="range"
            className="admin-slider"
            min={min}
            max={max}
            step={step}
            value={value}
            style={{
                background: `linear-gradient(to right, #10B981 0%, #10B981 ${pct}%, #E5E7EB ${pct}%, #E5E7EB 100%)`,
            }}
            onChange={(e) => onChange(Number(e.target.value))}
        />
    );
}

/* ── Section card ────────────────────────────────────── */
function SectionCard({ icon, iconColor, title, subtitle, children }) {
    return (
        <div className="rules-card">
            <div className="rules-card-header">
                <div className="rules-card-icon" style={{ background: iconColor }}>
                    {icon}
                </div>
                <div>
                    <div className="rules-card-title">{title}</div>
                    <div className="rules-card-sub">{subtitle}</div>
                </div>
            </div>
            <div className="rules-card-body">{children}</div>
        </div>
    );
}

/* ── Slider row ──────────────────────────────────────── */
function SliderRow({ label, value, min, max, step, unit, onChange }) {
    return (
        <div className="rules-slider-row">
            <div className="rules-slider-label">{label}</div>
            <div className="rules-slider-control">
                <RangeSlider value={value} min={min} max={max} step={step} onChange={onChange} />
                <span className="admin-rule-val">{value}{unit}</span>
            </div>
        </div>
    );
}

/* ── Number input row ────────────────────────────────── */
function InputRow({ label, value, min, max, step, unit, onChange }) {
    return (
        <div className="rules-input-col">
            <label className="rules-input-label">{label}</label>
            <div className="rules-input-wrap">
                <input
                    type="number"
                    className="rules-number-input"
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => onChange(Number(e.target.value))}
                />
                {unit && <span className="rules-input-unit">{unit}</span>}
            </div>
        </div>
    );
}

export default function AdminRules() {
    const navigate = useNavigate();
    const [adminUser, setAdminUser] = useState(null);
    const [settings, setSettings] = useState({ ...DEFAULTS });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');
    const [showLogout, setShowLogout] = useState(false);

    /* ── Helper to update a single field ── */
    const set = (key) => (val) => setSettings((prev) => ({ ...prev, [key]: val }));

    /* ── Load from Firestore ── */
    const loadSettings = useCallback(async () => {
        try {
            const snap = await getDoc(doc(db, 'adminSettings', 'rules'));
            if (snap.exists()) {
                setSettings({ ...DEFAULTS, ...snap.data() });
            }
        } catch { /* use defaults */ }
        finally { setLoading(false); }
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
            loadSettings();
        });
        return () => unsub();
    }, [navigate, loadSettings]);

    /* ── Save to Firestore ── */
    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        setSaveMsg('');
        try {
            await setDoc(doc(db, 'adminSettings', 'rules'), settings, { merge: true });
            setSaveMsg('✅ Settings saved successfully!');
        } catch (err) {
            setSaveMsg('❌ Save failed: ' + err.message);
        } finally {
            setSaving(false);
            setTimeout(() => setSaveMsg(''), 4000);
        }
    };

    const handleReset = () => {
        setSettings({ ...DEFAULTS });
        setSaveMsg('↺ Reset to default values. Click "Save All Settings" to apply.');
        setTimeout(() => setSaveMsg(''), 4000);
    };

    const handleLogout = async () => {
        await signOut(auth);
        navigate('/login');
    };

    /* ── Derived midpoint for 4-band preview ── */
    const midRisk = Math.round((settings.lowRiskScore + settings.highRiskScore) / 2);

    return (
        <>
            <div className="admin-layout">
                <AdminSidebar onLogout={() => setShowLogout(true)} />

                <div className="admin-main">
                    {/* ── Top Bar ── */}
                    <header className="admin-topbar">
                        <div className="admin-topbar-left">
                            <div className="admin-page-title">Rules and Settings</div>
                            <div className="admin-page-sub">
                                Configure system rules, thresholds, and behaviours
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

                    {loading ? (
                        <div className="admin-loading" style={{ padding: 60 }}>Loading settings…</div>
                    ) : (
                        <form className="admin-body" onSubmit={handleSave}>

                            {/* ══ 1. Health Threshold Rules ══════════════════════ */}
                            <SectionCard
                                icon="🩺"
                                iconColor="#D1FAE5"
                                title="Health Threshold Rules"
                                subtitle="Set alert thresholds for health metrics"
                            >
                                <SliderRow
                                    label="Maximum Glucose Threshold (mg/dL)"
                                    value={settings.maxGlucose}
                                    min={100} max={300} step={5} unit=""
                                    onChange={set('maxGlucose')}
                                />
                                <SliderRow
                                    label="Maximum Sugary Drinks per Day"
                                    value={settings.maxSugaryDrinks}
                                    min={0} max={10} step={1} unit=""
                                    onChange={set('maxSugaryDrinks')}
                                />
                                <SliderRow
                                    label="Weight Change Alert (kg per week)"
                                    value={settings.weightChangeAlert}
                                    min={0} max={5} step={0.5} unit=" kg"
                                    onChange={set('weightChangeAlert')}
                                />
                                <SliderRow
                                    label="Minimum Activity Minutes per Week"
                                    value={settings.minActivityMinutes}
                                    min={0} max={300} step={10} unit=" min"
                                    onChange={set('minActivityMinutes')}
                                />

                                {/* 3-column input row */}
                                <div className="rules-input-row" style={{ marginTop: 20 }}>
                                    <InputRow
                                        label="Min Fasting Glucose (mg/dL)"
                                        value={settings.minFastingGlucose}
                                        min={50} max={200} step={1}
                                        onChange={set('minFastingGlucose')}
                                    />
                                    <InputRow
                                        label="Max Post-Meal Glucose (mg/dL)"
                                        value={settings.maxPostMealGlucose}
                                        min={100} max={300} step={1}
                                        onChange={set('maxPostMealGlucose')}
                                    />
                                    <InputRow
                                        label="Max BMI (Asian threshold = 23)"
                                        value={settings.maxBMI}
                                        min={18} max={45} step={0.5}
                                        onChange={set('maxBMI')}
                                    />
                                </div>
                            </SectionCard>

                            {/* ══ 2. Risk Assessment Settings ═════════════════════ */}
                            <SectionCard
                                icon="⚠️"
                                iconColor="#FEF3C7"
                                title="Risk Assessment Settings"
                                subtitle="Control the four risk band boundaries shown on user dashboards"
                            >
                                {/* The two admin-editable thresholds */}
                                <div className="rules-input-row">
                                    <InputRow
                                        label="Low → Moderate Threshold (%)"
                                        value={settings.lowRiskScore}
                                        min={5} max={settings.highRiskScore - 5} step={1}
                                        onChange={set('lowRiskScore')}
                                    />
                                    <InputRow
                                        label="High → Very High Threshold (%)"
                                        value={settings.highRiskScore}
                                        min={settings.lowRiskScore + 5} max={99} step={1}
                                        onChange={set('highRiskScore')}
                                    />
                                </div>

                                {/* Live band preview — updates as sliders move */}
                                <div className="rules-formula-wrap" style={{ marginTop: 16 }}>
                                    <label className="rules-input-label">Risk Band Preview</label>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                        {[
                                            { label: '🟢 Low',       range: `0 – ${settings.lowRiskScore}%`,           bg: '#ECFDF5', color: '#059669' },
                                            { label: '🟡 Moderate',  range: `${settings.lowRiskScore} – ${midRisk}%`,   bg: '#FFFBEB', color: '#D97706' },
                                            { label: '🟠 High',      range: `${midRisk} – ${settings.highRiskScore}%`,  bg: '#FFF7ED', color: '#EA580C' },
                                            { label: '🔴 Very High', range: `${settings.highRiskScore} – 100%`,         bg: '#FEF2F2', color: '#DC2626' },
                                        ].map((b) => (
                                            <div
                                                key={b.label}
                                                style={{
                                                    background: b.bg, color: b.color,
                                                    border: `1px solid ${b.color}44`,
                                                    borderRadius: 8, padding: '6px 14px',
                                                    fontSize: 13, fontWeight: 600,
                                                }}
                                            >
                                                {b.label}{' '}
                                                <span style={{ fontWeight: 400, opacity: 0.8 }}>{b.range}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="rules-formula-hint" style={{ marginTop: 10 }}>
                                        Moderate–High split is the midpoint between the two thresholds · These bands are live on the user dashboard
                                    </div>
                                </div>

                                {/* Actual logistic regression formula — read-only reference */}
                                <div className="rules-formula-wrap" style={{ marginTop: 16 }}>
                                    <label className="rules-input-label">Logistic Regression Formula (read-only)</label>
                                    <input
                                        type="text"
                                        className="rules-formula-input"
                                        value={settings.riskFormula}
                                        readOnly
                                        style={{
                                            background: '#F9FAFB', cursor: 'default',
                                            color: '#374151', fontFamily: 'monospace', fontSize: 12,
                                        }}
                                    />
                                    <div className="rules-formula-hint">
                                        σ = sigmoid function · All features are normalised 0–1 using ADA/WHO clinical ranges ·
                                        Output is a probability (0–100%) · Weights are in <code>src/hooks/useDiabetesRisk.js</code>
                                    </div>
                                </div>
                            </SectionCard>

                            {/* ══ 3. Notification Settings ════════════════════════ */}
                            <SectionCard
                                icon="🔔"
                                iconColor="#DBEAFE"
                                title="Notification Settings"
                                subtitle="Manage system notification preferences"
                            >
                                {/* Toggles */}
                                <div className="rules-toggle-row">
                                    <div className="rules-toggle-meta">
                                        <div className="rules-toggle-title">Email Notifications</div>
                                        <div className="rules-toggle-sub">Send email alerts for health events</div>
                                    </div>
                                    <Toggle
                                        value={settings.emailNotifications}
                                        onChange={set('emailNotifications')}
                                    />
                                </div>
                                <div className="rules-toggle-row">
                                    <div className="rules-toggle-meta">
                                        <div className="rules-toggle-title">Push Notifications</div>
                                        <div className="rules-toggle-sub">Send in-app push alerts to users</div>
                                    </div>
                                    <Toggle
                                        value={settings.pushNotifications}
                                        onChange={set('pushNotifications')}
                                    />
                                </div>

                                {/* Time + day */}
                                <div className="rules-input-row" style={{ marginTop: 16 }}>
                                    <div className="rules-input-col">
                                        <label className="rules-input-label">Day Reminder Time</label>
                                        <input
                                            type="time"
                                            className="rules-number-input"
                                            value={settings.reminderTime}
                                            onChange={(e) => set('reminderTime')(e.target.value)}
                                            style={{ minWidth: 140 }}
                                        />
                                    </div>
                                    <div className="rules-input-col">
                                        <label className="rules-input-label">Weekly Report Day</label>
                                        <select
                                            className="admin-filter-select"
                                            value={settings.weeklyReportDay}
                                            onChange={(e) => set('weeklyReportDay')(e.target.value)}
                                        >
                                            {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
                                                <option key={d}>{d}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </SectionCard>

                            {/* ══ 4. System Settings ══════════════════════════════ */}
                            <SectionCard
                                icon="🔧"
                                iconColor="#EDE9FE"
                                title="System Settings"
                                subtitle="Configure system security and activity"
                            >
                                <div className="rules-input-row">
                                    <InputRow
                                        label="Max Password Days"
                                        value={settings.maxPasswordDays}
                                        min={1} max={365} step={1} unit="days"
                                        onChange={set('maxPasswordDays')}
                                    />
                                    <InputRow
                                        label="Max Login Attempts"
                                        value={settings.maxLoginAttempts}
                                        min={1} max={20} step={1} unit="tries"
                                        onChange={set('maxLoginAttempts')}
                                    />
                                    <InputRow
                                        label="Session Timeout (minutes)"
                                        value={settings.sessionTimeout}
                                        min={1} max={480} step={5} unit="min"
                                        onChange={set('sessionTimeout')}
                                    />
                                    <InputRow
                                        label="Max Report Size (per month)"
                                        value={settings.maxReportSize}
                                        min={1} max={100} step={1} unit="MB"
                                        onChange={set('maxReportSize')}
                                    />
                                </div>
                            </SectionCard>

                            {/* ══ Save / Reset buttons ══════════════════════════ */}
                            {saveMsg && (
                                <div className={`admin-save-msg ${saveMsg.startsWith('❌') ? 'error' : ''}`}>
                                    {saveMsg}
                                </div>
                            )}

                            <div className="rules-bottom-actions">
                                <button
                                    type="submit"
                                    className="rules-save-btn"
                                    disabled={saving}
                                >
                                    {saving ? '⏳ Saving…' : '💾 Save All Settings'}
                                </button>
                                <button
                                    type="button"
                                    className="rules-reset-btn"
                                    onClick={handleReset}
                                >
                                    ↺ Reset to Defaults
                                </button>
                            </div>
                        </form>
                    )}
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
