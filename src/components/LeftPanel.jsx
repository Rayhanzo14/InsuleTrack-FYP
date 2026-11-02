import React from 'react';
import logo from '../assets/logo.png';

const features = [
    { icon: '📈', title: 'Track Activity', desc: 'Monitor daily movement' },
    { icon: '🛡️', title: 'Reduce Risk', desc: 'Evidence-based support' },
    { icon: '💚', title: 'Stay Healthy', desc: 'Build better habits' },
];

export default function LeftPanel() {
    return (
        <div className="left-panel">
            {/* Brand */}
            <div className="brand-row">
                <div className="brand-logo">
                    <img src={logo} alt="InsuleTrack logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 12 }} />
                </div>
                <div className="brand-text">
                    <h1>InsuleTrack</h1>
                    <p>Diabetes Prevention Support</p>
                </div>
            </div>

            {/* SDG Badge */}
            <div className="sdg-badge">
                <span className="dot" />
                <div className="sdg-label">
                    <strong>Supporting SDG 3</strong>
                    <small>Good Health and Well-being</small>
                </div>
            </div>

            {/* Tagline */}
            <p className="tagline">
                Take control of your health journey with personalized lifestyle
                tracking designed to help adults prevent diabetes.
            </p>

            {/* Feature Cards */}
            <div className="feature-cards">
                {features.map((f) => (
                    <div className="feature-card" key={f.title}>
                        <div className="fc-icon">{f.icon}</div>
                        <div className="fc-title">{f.title}</div>
                        <div className="fc-desc">{f.desc}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
