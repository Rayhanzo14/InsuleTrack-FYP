import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/logo.png';
import '../landing.css';

/* ── Fake bar heights for the mini chart ─────────────────── */
const BARS = [
    { h: '40%' }, { h: '55%' }, { h: '48%' }, { h: '70%', hi: true },
    { h: '62%' }, { h: '80%', hi: true }, { h: '72%' },
];

const FEATURES = [
    {
        icon: '🩸', color: 'green',
        title: 'Blood Sugar Tracking',
        desc: 'Log fasting and post-meal glucose levels daily. Track HbA1c trends and stay within healthy ranges with visual alerts.',
    },
    {
        icon: '📊', color: 'blue',
        title: 'Progress Visualisation',
        desc: 'Interactive charts show your blood sugar, weight, and activity trends over time — Today, 7 days, or 30 days at a glance.',
    },
    {
        icon: '🤖', color: 'purple',
        title: 'Smart Recommendations',
        desc: 'A rule-based decision support system analyses your data and generates personalised health tips tailored to your readings.',
    },
    {
        icon: '🏆', color: 'orange',
        title: 'Achievements & Goals',
        desc: 'Stay motivated with milestone badges — from your first log entry to 7-day streaks and perfect blood sugar days.',
    },
    {
        icon: '📋', color: 'teal',
        title: 'Health Reports',
        desc: 'Generate comprehensive summaries of your health data, exportable for sharing with your healthcare provider.',
    },
    {
        icon: '🔒', color: 'red',
        title: 'Secure & Private',
        desc: 'Your health data is protected by Firebase Authentication and Firestore security rules — always encrypted, never shared.',
    },
];

const STEPS = [
    {
        n: '01',
        title: 'Create your account',
        desc: 'Sign up in seconds with Google or email. We\'ll set up your personal health profile with your diabetes type, age, and goals.',
    },
    {
        n: '02',
        title: 'Record your daily data',
        desc: 'Log your blood sugar readings, meals, physical activity, and weight each day. It takes less than 2 minutes.',
    },
    {
        n: '03',
        title: 'Track your progress',
        desc: 'View interactive charts and analytics that reveal patterns in your data. Understand what affects your glucose levels.',
    },
    {
        n: '04',
        title: 'Get personalised tips',
        desc: 'Our recommendation engine analyses your lifestyle data and surfaces actionable health tips specific to your situation.',
    },
];

const STATS = [
    { val: '7+', label: 'Core Health Features' },
    { val: '30', label: 'Days of Trend History' },
    { val: '24/7', label: 'Data Availability' },
    { val: '100%', label: 'Privacy Guaranteed' },
];

export default function LandingPage() {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Smooth scroll helper
    const scrollTo = (id) => (e) => {
        e.preventDefault();
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div className="lp-root">

            {/* ── Nav ──────────────────────────────────────────── */}
            <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
                <a className="lp-nav-brand" href="#top">
                    <div className="lp-nav-logo"><img src={logo} alt="InsuleTrack" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }} /></div>
                    <span className="lp-nav-name">Insule<span>Track</span></span>
                </a>

                <div className="lp-nav-links">
                    <a className="lp-nav-link" href="#features" onClick={scrollTo('features')}>Features</a>
                    <a className="lp-nav-link" href="#how"      onClick={scrollTo('how')}>How it works</a>
                    <a className="lp-nav-link" href="#sdg"      onClick={scrollTo('sdg')}>About</a>
                </div>

                <div className="lp-nav-cta">
                    <Link to="/login"    className="lp-btn-ghost">Log in</Link>
                    <Link to="/register" className="lp-btn-solid">Get started →</Link>
                </div>
            </nav>

            {/* ── Hero ─────────────────────────────────────────── */}
            <section className="lp-hero" id="top">
                <div className="lp-hero-inner">

                    {/* Left copy */}
                    <div className="lp-hero-left">
                        <div className="lp-hero-badge">
                            <span className="lp-badge-dot" />
                            SDG 3 — Good Health &amp; Well‑Being
                        </div>

                        <h1 className="lp-hero-title">
                            Manage your diabetes<br />
                            <span className="lp-title-green">with clarity.</span>
                        </h1>

                        <p className="lp-hero-sub">
                            InsuleTrack helps people living with diabetes log their daily health data,
                            visualise trends, and receive personalised recommendations — all in one place.
                        </p>

                        <div className="lp-hero-actions">
                            <Link to="/register" className="lp-hero-btn-primary">
                                🚀 Start tracking free
                            </Link>
                            <a href="#how" className="lp-hero-btn-outline" onClick={scrollTo('how')}>
                                ▶ See how it works
                            </a>
                        </div>

                        <div className="lp-hero-trust">
                            <div className="lp-hero-trust-avatars">
                                {['🧑', '👩', '👨', '🧓'].map((e, i) => (
                                    <div className="av" key={i}>{e}</div>
                                ))}
                            </div>
                            <div className="lp-hero-trust-text">
                                Built to support <strong>real patients</strong> and their healthcare journeys
                            </div>
                        </div>
                    </div>

                    {/* Right visual */}
                    <div className="lp-hero-visual">
                        <div className="lp-dashboard-card">
                            <div className="lp-card-header">
                                <span className="lp-card-title">🩸 Blood Sugar Trends</span>
                                <span className="lp-card-badge">✓ Normal</span>
                            </div>

                            {/* Mini bar chart */}
                            <div className="lp-mini-chart">
                                {BARS.map((b, i) => (
                                    <div
                                        key={i}
                                        className={`lp-bar${b.hi ? ' highlight' : ''}`}
                                        style={{ height: b.h }}
                                    />
                                ))}
                            </div>
                            <div className="lp-chart-labels">
                                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d) => (
                                    <span key={d}>{d}</span>
                                ))}
                            </div>

                            <div className="lp-metric-row">
                                <div className="lp-metric">
                                    <div className="lp-metric-val">92 <span>mg/dL</span></div>
                                    <div className="lp-metric-lbl">Avg Fasting</div>
                                </div>
                                <div className="lp-metric">
                                    <div className="lp-metric-val">128 <span>mg/dL</span></div>
                                    <div className="lp-metric-lbl">Post‑Meal</div>
                                </div>
                                <div className="lp-metric">
                                    <div className="lp-metric-val">5.4 <span>%</span></div>
                                    <div className="lp-metric-lbl">HbA1c</div>
                                </div>
                            </div>
                        </div>

                        {/* Floating mini cards */}
                        <div className="lp-float-card fc-left">
                            <div className="lp-float-icon green">⚡</div>
                            <div>
                                <div className="lp-float-label">Activity Today</div>
                                <div className="lp-float-value">45 min</div>
                            </div>
                        </div>

                        <div className="lp-float-card fc-right">
                            <div className="lp-float-icon purple">🏆</div>
                            <div>
                                <div className="lp-float-label">Achievement</div>
                                <div className="lp-float-value">7-Day Streak!</div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Stats ────────────────────────────────────────── */}
            <section className="lp-stats">
                <div className="lp-stats-inner">
                    {STATS.map(({ val, label }) => (
                        <div key={label}>
                            <div className="lp-stat-val">{val}</div>
                            <div className="lp-stat-label">{label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Features ─────────────────────────────────────── */}
            <section className="lp-features" id="features">
                <div className="lp-section-header">
                    <span className="lp-section-tag">Features</span>
                    <h2 className="lp-section-title">Everything you need to stay on top of your health</h2>
                    <p className="lp-section-sub">
                        Built specifically for diabetes management — from daily logging to personalised insights.
                    </p>
                </div>

                <div className="lp-features-grid">
                    {FEATURES.map(({ icon, color, title, desc }) => (
                        <div className="lp-feat-card" key={title}>
                            <div className={`lp-feat-icon ${color}`}>{icon}</div>
                            <div className="lp-feat-title">{title}</div>
                            <div className="lp-feat-desc">{desc}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── How it works ─────────────────────────────────── */}
            <section className="lp-how" id="how">
                <div className="lp-section-header">
                    <span className="lp-section-tag">How It Works</span>
                    <h2 className="lp-section-title">Up and running in minutes</h2>
                    <p className="lp-section-sub">
                        A simple four-step journey from sign-up to actionable health insights.
                    </p>
                </div>

                <div className="lp-how-steps">
                    {STEPS.map(({ n, title, desc }) => (
                        <div className="lp-step" key={n}>
                            <div className="lp-step-num">{n}</div>
                            <div className="lp-step-body">
                                <div className="lp-step-title">{title}</div>
                                <div className="lp-step-desc">{desc}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── SDG Callout ──────────────────────────────────── */}
            <section className="lp-sdg" id="sdg">
                <div className="lp-sdg-inner">
                    <div>
                        <div className="lp-sdg-tag">United Nations SDG</div>
                        <h2 className="lp-sdg-title">Supporting Good Health<br />and Well-Being globally</h2>
                        <p className="lp-sdg-desc">
                            InsuleTrack is aligned with UN Sustainable Development Goal 3 — ensuring healthy lives and
                            promoting well-being for all. By empowering individuals with diabetes to self-manage effectively,
                            we contribute to reducing preventable illness and improving quality of life.
                        </p>
                    </div>
                    <div className="lp-sdg-badge-big">
                        <div className="lp-sdg-goal-num">3</div>
                        <div className="lp-sdg-goal-label">Good Health<br />&amp; Well‑Being</div>
                    </div>
                </div>
            </section>

            {/* ── CTA ──────────────────────────────────────────── */}
            <section className="lp-cta">
                <div className="lp-cta-inner">
                    <h2 className="lp-cta-title">
                        Ready to take control<br />of your <span>diabetes journey</span>?
                    </h2>
                    <p className="lp-cta-sub">
                        Join InsuleTrack today. Free to use — no credit card required.
                        Start logging in under 2 minutes.
                    </p>
                    <Link to="/register" className="lp-cta-btn">
                        🚀 Create your free account
                    </Link>
                </div>
            </section>

            {/* ── Footer ───────────────────────────────────────── */}
            <footer className="lp-footer">
                <div className="lp-footer-inner">
                    <a className="lp-footer-brand" href="#top">
                        <div className="lp-footer-logo"><img src={logo} alt="InsuleTrack" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 6 }} /></div>
                        <span className="lp-footer-name">InsuleTrack</span>
                    </a>

                    <span className="lp-footer-copy">
                        © {new Date().getFullYear()} InsuleTrack · Final Year Project
                    </span>

                    <div className="lp-footer-links">
                        <Link to="/login"    className="lp-footer-link">Log in</Link>
                        <Link to="/register" className="lp-footer-link">Register</Link>
                    </div>
                </div>
            </footer>

        </div>
    );
}
