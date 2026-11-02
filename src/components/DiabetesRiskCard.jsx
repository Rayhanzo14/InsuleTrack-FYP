import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDiabetesRisk } from '../hooks/useDiabetesRisk';

// ── Animated SVG Gauge Ring ───────────────────────────────────────────────────
function GaugeRing({ percent, color, size = 140 }) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const [displayed, setDisplayed] = useState(0);
    const animRef = useRef(null);

    useEffect(() => {
        // Animate from 0 to target percent over 1.2s
        const target = percent;
        const duration = 1200;
        const startTime = performance.now();

        const animate = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplayed(Math.round(eased * target));
            if (progress < 1) {
                animRef.current = requestAnimationFrame(animate);
            }
        };

        animRef.current = requestAnimationFrame(animate);
        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
        };
    }, [percent]);

    const offset = circumference - (displayed / 100) * circumference;

    return (
        <div className="risk-gauge-wrap">
            <svg width={size} height={size} viewBox="0 0 120 120">
                {/* Background track */}
                <circle
                    cx="60" cy="60" r={radius}
                    fill="none"
                    stroke="#F3F4F6"
                    strokeWidth="10"
                />
                {/* Animated fill */}
                <circle
                    cx="60" cy="60" r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    transform="rotate(-90 60 60)"
                    style={{ transition: 'stroke 0.3s ease' }}
                />
                {/* Center text */}
                <text x="60" y="55" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1a1a2e">
                    {displayed}%
                </text>
                <text x="60" y="72" textAnchor="middle" fontSize="10" fill="#9CA3AF">
                    risk score
                </text>
            </svg>
        </div>
    );
}

// ── Factor Bar ────────────────────────────────────────────────────────────────
function FactorBar({ label, contribution, color }) {
    const pct = Math.min(100, Math.round(contribution * 100));
    return (
        <div className="risk-factor-row">
            <div className="risk-factor-label">{label}</div>
            <div className="risk-factor-bar-track">
                <div
                    className="risk-factor-bar-fill"
                    style={{ width: `${pct}%`, background: color }}
                />
            </div>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DiabetesRiskCard({ userId }) {
    const { loading, hasData, riskPercent, riskLevel, factors, missingFields } =
        useDiabetesRisk(userId);

    // ── Loading skeleton ──────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="risk-card risk-card-loading">
                <div className="risk-card-header">
                    <span className="risk-card-icon">🧠</span>
                    <div>
                        <div className="risk-card-title">AI Diabetes Risk Assessment</div>
                        <div className="risk-card-sub">Analysing your health data…</div>
                    </div>
                </div>
                <div className="risk-skeleton-row">
                    <div className="risk-skeleton risk-skeleton-circle" />
                    <div style={{ flex: 1 }}>
                        <div className="risk-skeleton risk-skeleton-line" style={{ width: '70%' }} />
                        <div className="risk-skeleton risk-skeleton-line" style={{ width: '50%', marginTop: 8 }} />
                        <div className="risk-skeleton risk-skeleton-line" style={{ width: '60%', marginTop: 8 }} />
                    </div>
                </div>
            </div>
        );
    }

    // ── No data state ─────────────────────────────────────────────────────────
    if (!hasData) {
        return (
            <div className="risk-card risk-card-empty">
                <div className="risk-card-header">
                    <span className="risk-card-icon">🧠</span>
                    <div>
                        <div className="risk-card-title">AI Diabetes Risk Assessment</div>
                        <div className="risk-card-sub">Powered by logistic regression ML model</div>
                    </div>
                    <span className="risk-badge-pill" style={{ background: '#F3F4F6', color: '#6B7280' }}>
                        No Data Yet
                    </span>
                </div>

                <div className="risk-empty-body">
                    <div className="risk-empty-icon">📋</div>
                    <div className="risk-empty-title">Not enough data to predict</div>
                    <div className="risk-empty-desc">
                        Log at least your <strong>fasting glucose</strong> or <strong>HbA1c</strong> to get your personalised diabetes risk score.
                    </div>

                    {missingFields.length > 0 && (
                        <div className="risk-missing-list">
                            <div className="risk-missing-label">Missing data:</div>
                            {missingFields.map((f) => (
                                <span key={f} className="risk-missing-tag">📌 {f}</span>
                            ))}
                        </div>
                    )}

                    <Link to="/record" className="risk-cta-btn">
                        ➕ Log today's health data
                    </Link>
                </div>

                <div className="risk-disclaimer">
                    🔬 This is a screening tool only, not a medical diagnosis. Consult your doctor for clinical advice.
                </div>
            </div>
        );
    }

    // ── Full prediction view ───────────────────────────────────────────────────
    const { level, color, bg, border, emoji } = riskLevel;

    return (
        <div className="risk-card" style={{ borderTop: `4px solid ${color}` }}>
            {/* Header */}
            <div className="risk-card-header">
                <span className="risk-card-icon">🧠</span>
                <div style={{ flex: 1 }}>
                    <div className="risk-card-title">Diabetes Risk Assessment</div>
                    <div className="risk-card-sub">Powered by logistic regression ML model</div>
                </div>
                <span
                    className="risk-badge-pill"
                    style={{ background: bg, color: color, border: `1px solid ${border}` }}
                >
                    {emoji} {level} Risk
                </span>
            </div>

            {/* Body: Gauge + Factors */}
            <div className="risk-body">
                {/* Left: Gauge */}
                <div className="risk-gauge-col">
                    <GaugeRing percent={riskPercent} color={color} />
                    <div className="risk-level-label" style={{ color }}>
                        {level} Risk
                    </div>
                    <div className="risk-level-desc" style={{ background: bg, borderColor: border }}>
                        {level === 'Low' && 'Your metrics look healthy. Keep it up!'}
                        {level === 'Moderate' && 'Some indicators need attention.'}
                        {level === 'High' && 'Multiple elevated risk factors detected.'}
                        {level === 'Very High' && 'Consult a healthcare provider soon.'}
                    </div>
                </div>

                {/* Right: Contributing Factors */}
                <div className="risk-factors-col">
                    <div className="risk-factors-title">📊 Top Contributing Factors</div>

                    {factors.length > 0 ? (
                        <div className="risk-factors-list">
                            {factors.map((f) => (
                                <FactorBar
                                    key={f.key}
                                    label={f.label}
                                    contribution={f.contribution}
                                    color={color}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="risk-factors-empty">
                            ✅ No major risk factors detected in your current data.
                        </div>
                    )}

                    {/* What to do */}
                    <div className="risk-advice">
                        <div className="risk-advice-title">💡 Recommendation</div>
                        <div className="risk-advice-text">
                            {level === 'Low' && 'Continue your healthy habits. Log data daily to keep your risk score up to date.'}
                            {level === 'Moderate' && 'Increase physical activity and monitor your glucose levels more closely.'}
                            {level === 'High' && 'Consider scheduling a medical check-up and reviewing your diet and exercise habits.'}
                            {level === 'Very High' && 'Please consult a healthcare professional. Your glucose or HbA1c levels may need medical attention.'}
                        </div>
                    </div>

                    {/* Missing data notice */}
                    {missingFields.length > 0 && (
                        <div className="risk-missing-notice">
                            <span>ℹ️</span>
                            <span>Improve accuracy by adding: {missingFields.join(', ')}</span>
                            <Link to="/record" className="risk-log-link">Log now →</Link>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="risk-footer">
                <div className="risk-disclaimer">
                    🔬 Screening tool only — not a medical diagnosis. Consult your doctor for clinical advice.
                </div>
                <Link to="/record" className="risk-update-btn">
                    🔄 Update with today's data
                </Link>
            </div>
        </div>
    );
}
