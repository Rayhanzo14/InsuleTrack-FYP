import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import Sidebar from '../components/Sidebar';
import TopHeader from '../components/TopHeader';
import '../dashboard.css';
import '../recommendations.css';

/* ─────────────────────────────────────────────────────────────
   FULL TIP POOL  (30 unique tips across 5 categories)
   Each tip has a numeric id, so the rotation picks 6 per day
   based on a deterministic seed (userId + YYYY-MM-DD).
   ───────────────────────────────────────────────────────────── */
const ALL_TIPS = [
    // ── Activity ──
    { id: 1, title: 'Add 1,000 more steps today', category: 'activity', icon: '🏃', desc: "Take a short 10-minute walk after each meal. Small bursts of movement add up quickly and help lower post-meal blood sugar." },
    { id: 2, title: 'Try a morning stretch routine', category: 'activity', icon: '🤸', desc: "5 minutes of stretching each morning improves circulation, reduces stiffness, and sets a positive tone for the day." },
    { id: 3, title: 'Take the stairs today', category: 'activity', icon: '🪜', desc: "Swap the elevator for stairs whenever possible. Even 2–3 flights a day strengthens legs and boosts heart health." },
    { id: 4, title: 'Go for a 20-minute evening walk', category: 'activity', icon: '🌅', desc: "An evening stroll after dinner is one of the most effective ways to stabilise post-meal glucose levels." },
    { id: 5, title: 'Try light resistance exercises', category: 'activity', icon: '💪', desc: "Body-weight exercises—squats, push-ups, lunges—build muscle which improves insulin sensitivity over time." },
    { id: 6, title: 'Reduce sitting time', category: 'activity', icon: '⏱️', desc: "Set a reminder to stand up every 30–40 minutes. Prolonged sitting raises blood sugar more than you might think." },
    // ── Food ──
    { id: 7, title: 'Add colour to every plate', category: 'food', icon: '🥗', desc: "Aim for 3 different coloured vegetables per meal. The variety of nutrients supports insulin function and gut health." },
    { id: 8, title: 'Swap white rice for brown rice', category: 'food', icon: '🌾', desc: "Brown rice has a significantly lower glycaemic index than white rice, resulting in slower blood sugar rises after meals." },
    { id: 9, title: 'Eat a protein-rich breakfast', category: 'food', icon: '🥚', desc: "Starting your day with protein (eggs, Greek yoghurt, nuts) reduces mid-morning crashes and controls appetite." },
    { id: 10, title: 'Reduce sugary drink intake', category: 'food', icon: '🧃', desc: "Replace one sweetened drink with water or unsweetened tea today. Liquid sugar spikes blood glucose very quickly." },
    { id: 11, title: 'Try a high-fibre snack', category: 'food', icon: '🫘', desc: "Chickpeas, edamame, or almonds between meals slow glucose absorption and help you feel full longer." },
    { id: 12, title: 'Cook with olive oil today', category: 'food', icon: '🫒', desc: "Replacing saturated fats with olive oil improves cholesterol levels and reduces inflammation linked to diabetes." },
    { id: 13, title: 'Eat at regular intervals', category: 'food', icon: '🍽️', desc: "Skipping meals causes blood sugar swings. Aim for consistent meal times — roughly every 4–5 hours during the day." },
    // ── Lifestyle ──
    { id: 14, title: 'Drink 8 glasses of water', category: 'lifestyle', icon: '💧', desc: "Staying well-hydrated helps your kidneys flush out excess glucose. Set a water bottle on your desk as a visual reminder." },
    { id: 15, title: 'Aim for 7–8 hours of sleep', category: 'lifestyle', icon: '🌙', desc: "Poor sleep impairs insulin sensitivity by up to 25%. A consistent bedtime improves glucose control and energy levels." },
    { id: 16, title: 'Limit screen time before bed', category: 'lifestyle', icon: '📱', desc: "Blue light from screens suppresses melatonin and disrupts sleep quality. Try switching off 30 minutes before bed." },
    { id: 17, title: 'Track your meals today', category: 'lifestyle', icon: '📋', desc: "Logging what you eat — even roughly — builds awareness of portion sizes and triggers mindful food choices." },
    { id: 18, title: 'Take your medication on time', category: 'lifestyle', icon: '💊', desc: "Missing or delaying medication can lead to blood sugar spikes. Set a phone alarm if timing is a challenge." },
    { id: 19, title: 'Monitor your blood pressure', category: 'lifestyle', icon: '🩺', desc: "High blood pressure and diabetes often go together. Checking it weekly gives your healthcare team better data." },
    // ── Wellness ──
    { id: 20, title: 'Try 5 minutes of deep breathing', category: 'wellness', icon: '🧘', desc: "Box breathing (inhale 4s, hold 4s, exhale 4s) lowers cortisol levels, which in turn reduces blood sugar spikes from stress." },
    { id: 21, title: 'Write 3 things you are grateful for', category: 'wellness', icon: '📓', desc: "Gratitude journalling has been shown to reduce anxiety and improve overall mental well-being in people with chronic conditions." },
    { id: 22, title: 'Connect with a friend or family member', category: 'wellness', icon: '🤝', desc: "Social support is a key predictor of health outcomes. A short chat or call can motivate you to stay on track." },
    { id: 23, title: 'Take a short mindfulness break', category: 'wellness', icon: '🌿', desc: "Even 2 minutes of guided mindfulness midday reduces stress hormones that interfere with blood sugar regulation." },
    { id: 24, title: 'Reduce caffeine after 2 PM', category: 'wellness', icon: '☕', desc: "Late caffeine can disrupt sleep onset. Better sleep means better glucose control — so the cutoff really matters." },
    // ── Blood Sugar ──
    { id: 25, title: 'Log your fasting glucose', category: 'bloodsugar', icon: '🩸', desc: "Consistent fasting readings help you and your doctor spot trends early. Log it every morning before eating." },
    { id: 26, title: 'Check post-meal readings', category: 'bloodsugar', icon: '📈', desc: "Measuring blood sugar 2 hours after eating shows how your body responds to specific foods. Use the data to adapt your diet." },
    { id: 27, title: 'Avoid late-night snacking', category: 'bloodsugar', icon: '🌃', desc: "Eating close to bedtime raises overnight glucose. Try stopping eating 2–3 hours before you intend to sleep." },
    { id: 28, title: 'Learn your HbA1c target', category: 'bloodsugar', icon: '🎯', desc: "HbA1c below 6.5% is the general target for diabetes prevention. Ask your doctor about yours and track progress monthly." },
    { id: 29, title: 'Identify your glucose triggers', category: 'bloodsugar', icon: '🔍', desc: "Some foods spike blood sugar more than others. Use your logs to find patterns — then make targeted adjustments." },
    { id: 30, title: 'Celebrate blood sugar wins', category: 'bloodsugar', icon: '🏅', desc: "When your readings are in range, acknowledge it! Positive reinforcement helps you stick to healthy routines long-term." },
];

const CATEGORY_STYLE = {
    activity:   { bg: '#DCFCE7', text: '#15803D', label: 'Activity' },
    food:       { bg: '#FEF9C3', text: '#854D0E', label: 'Food' },
    lifestyle:  { bg: '#E0F2FE', text: '#075985', label: 'Lifestyle' },
    wellness:   { bg: '#FDF4FF', text: '#86198F', label: 'Wellness' },
    bloodsugar: { bg: '#FFE4E6', text: '#9F1239', label: 'Blood Sugar' },
};

/* ─────────────────────────────────────────────────────────────
   DAILY ROTATION LOGIC
   Seed = uid (numbers only) + YYYYMMdd → deterministic shuffle
   that changes every day but is the same for all page reloads
   on the same day.
   ───────────────────────────────────────────────────────────── */
function seededShuffle(arr, seed) {
    // Simple mulberry32 PRNG seeded with a number
    let s = seed | 0;
    const prng = () => {
        s = Math.imul(s ^ (s >>> 15), s | 1);
        s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
        return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(prng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function getDailySeed(uid) {
    const uidNum = uid ? uid.replace(/\D/g, '').slice(0, 8) : '12345678';
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    return (Number(uidNum) + Number(today)) % 2147483647;
}

function pickTips(uid, extraSeed = 0, count = 6) {
    const seed = (getDailySeed(uid) + extraSeed * 999983) % 2147483647;
    return seededShuffle(ALL_TIPS, seed).slice(0, count);
}

/* ─────────────────────────────────────────────────────────────
   COMPONENT
   ───────────────────────────────────────────────────────────── */
export default function Recommendations() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [userData, setUserData] = useState(null);
    const [dismissed, setDismissed] = useState(new Set());
    const [refreshKey, setRefreshKey] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [lastRefreshed, setLastRefreshed] = useState(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (u) => {
            if (!u) { navigate('/login'); return; }
            setUser(u);
            try {
                const snap = await getDoc(doc(db, 'users', u.uid));
                if (snap.exists()) setUserData(snap.data());
            } catch { /* use defaults */ }
        });
        return () => unsub();
    }, [navigate]);

    // Re-pick tips whenever uid changes OR the user presses refresh
    const dailyTips = useMemo(() => pickTips(user?.uid, refreshKey), [user?.uid, refreshKey]);

    const visible = dailyTips.filter((r) => !dismissed.has(r.id));

    const handleRefresh = useCallback(() => {
        setRefreshing(true);
        setDismissed(new Set());
        setRefreshKey((k) => k + 1);
        setLastRefreshed(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
        setTimeout(() => setRefreshing(false), 600);
    }, []);

    // Personalised header based on user data
    const firstName = (userData?.fullName || user?.displayName || 'there').split(' ')[0];

    return (
        <div className="db-layout">
            <Sidebar />

            <div className="db-main">
                <TopHeader user={user} />

                <div className="db-body">
                    {/* ── Title row ── */}
                    <div className="rec-title-row">
                        <div>
                            <div className="db-page-title">💡 Recommendations for you</div>
                            <div className="db-page-sub">
                                Hey {firstName}! Here are your personalised health tips.&nbsp;
                                <span className="rec-refresh-date">Last refreshed: {lastRefreshed}</span>
                                {userData?.targetWeight && (
                                    <span style={{ fontSize: 12, color: '#059669', background: '#D1FAE5', padding: '2px 8px', borderRadius: 999, marginLeft: 8 }}>
                                        🎯 Target: {userData.targetWeight} kg {userData.weight ? `(Current: ${userData.weight} kg)` : ''}
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            className="rec-refresh-btn"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            title="Get a new set of tips"
                        >
                            <span style={{
                                display: 'inline-block',
                                transition: 'transform 0.6s ease',
                                transform: refreshing ? 'rotate(360deg)' : 'rotate(0deg)',
                            }}>🔄</span>
                            {refreshing ? ' Refreshing…' : ' New tips'}
                        </button>
                    </div>

                    {/* ── Cards grid ── */}
                    <div className="rec-cards-grid">
                        {visible.map((r) => {
                            const col = CATEGORY_STYLE[r.category];
                            return (
                                <div className="rec-tip-card" key={r.id}>
                                    <div className="rec-tip-top">
                                        <div className="rec-tip-icon-wrap" style={{ background: col.bg }}>
                                            <span style={{ fontSize: 20 }}>{r.icon}</span>
                                        </div>
                                        <div className="rec-tip-meta">
                                            <div className="rec-tip-title">{r.title}</div>
                                            <span
                                                className="rec-tip-badge"
                                                style={{ background: col.bg, color: col.text }}
                                            >
                                                {col.label}
                                            </span>
                                        </div>
                                        <button
                                            className="rec-dismiss"
                                            onClick={() => setDismissed((prev) => new Set([...prev, r.id]))}
                                            title="Dismiss"
                                        >✕</button>
                                    </div>
                                    <div className="rec-tip-desc">{r.desc}</div>
                                </div>
                            );
                        })}

                        {visible.length === 0 && (
                            <div className="rec-empty">
                                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                                <div style={{ fontWeight: 600, color: '#374151' }}>All caught up!</div>
                                <div style={{ color: '#9CA3AF', fontSize: 13, marginTop: 6 }}>
                                    You've dismissed all of today's tips.
                                </div>
                                <button className="rec-refresh-btn" style={{ marginTop: 16 }} onClick={handleRefresh}>
                                    🔄 Restore tips
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Info banner ── */}
                    <div className="rec-rotation-info">
                        <span>💡</span>
                        <span>Click <strong>New tips</strong> any time to get a fresh set of 6 personalised health recommendations.</span>
                    </div>

                    {/* ── Progress banner ── */}
                    <div className="rec-progress-banner">
                        <div className="rec-banner-icon">🏆</div>
                        <div>
                            <div className="rec-banner-title">You're making great progress!</div>
                            <div className="rec-banner-desc">
                                Keep following these recommendations and you'll continue building healthy habits
                                that support diabetes prevention. Small consistent changes lead to big results.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
