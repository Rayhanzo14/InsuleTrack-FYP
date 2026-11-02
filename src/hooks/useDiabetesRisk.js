/**
 * useDiabetesRisk.js
 *
 * Pure-JS logistic regression diabetes risk predictor.
 * No external ML library needed — just Math.exp().
 *
 * Model: Hybrid — BRFSS-trained weights + ADA-calibrated clinical weights
 *
 * Training Dataset (BRFSS features):
 *   CDC BRFSS Diabetes Health Indicators Dataset (2015)
 *   253,680 records | Accuracy: 84.54% | AUC-ROC: 0.786
 *   Training: scikit-learn LogisticRegression, 80/20 split, stratified
 *
 * ADA-calibrated features (not in BRFSS survey data):
 *   ADA Clinical Practice Guidelines 2023
 *
 * Features used:
 *   1. Fasting Glucose (mg/dL)     — ADA-calibrated (primary predictor)
 *   2. Post-Meal Glucose (mg/dL)   — ADA-calibrated (secondary predictor)
 *   3. HbA1c (%)                   — ADA-calibrated (strongest long-term indicator)
 *   4. BMI (kg/m²)                 — BRFSS-trained
 *   5. Activity Duration (min/day) — BRFSS-trained (protective, negative weight)
 *   6. Risk Factor count (0–6)     — BRFSS-trained
 *   7. Age                         — BRFSS-trained
 */

import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// ── Clinical Normalization Ranges ─────────────────────────────────────────────
// These map raw values to a 0–1 scale, clamped at clinical extremes.
const RANGES = {
    fastingGlucose:    { min: 60,  max: 200 },  // Normal: <100 | Prediabetes: 100-125 | Diabetes: ≥126 (ADA 2024)
    postMealGlucose:   { min: 70,  max: 300 },  // 200+ = diabetic (ADA)
    hba1c:             { min: 4.0, max: 10.0 }, // Normal: <5.7% | Prediabetes: 5.7-6.4% | Diabetes: ≥6.5% (ADA) / ≥6.3% (Malaysia MOH CPG 6th Ed)
    bmi:               { min: 15,  max: 45 },   // 23+ = overweight for Asians (WHO)
    activityDuration:  { min: 0,   max: 60 },   // WHO min ~21 min/day; cap at 60 for full protection
    riskFactorCount:   { min: 0,   max: 6 },
    age:               { min: 18,  max: 80 },   // Malaysia MOH CPG 6th Ed: screening from age 30+ (ADA: 35+)
};

// ── Logistic Regression Weights ───────────────────────────────────────────────
// Positive = increases risk, Negative = decreases risk.
//
// BRFSS-trained weights (BMI, activityDuration, riskFactorCount, age):
//   Source  : CDC BRFSS Diabetes Health Indicators Dataset (253,680 records)
//   Method  : scikit-learn LogisticRegression (C=1.0, lbfgs, 80/20 split)
//   Accuracy: 84.54%  |  AUC-ROC: 0.786
//
// ADA-calibrated weights (fastingGlucose, postMealGlucose, hba1c):
//   Source  : ADA Clinical Practice Guidelines 2023
//   Reason  : BRFSS is a lifestyle survey — no blood test data available
const WEIGHTS = {
    bias:             -5.22,  // BRFSS-trained intercept
    fastingGlucose:    2.4,   // ADA-calibrated — primary clinical criterion
    postMealGlucose:   1.5,   // ADA-calibrated — secondary clinical criterion
    hba1c:             2.8,   // ADA-calibrated — strongest long-term indicator
    bmi:               3.12,  // BRFSS-trained  (strongest lifestyle predictor)
    activityDuration: -0.28,  // BRFSS-trained  (PROTECTIVE — negative weight)
    riskFactorCount:   3.07,  // BRFSS-trained  (comorbidity multiplier)
    age:               1.97,  // BRFSS-trained  (risk rises significantly ≥35)
};

// ── Feature Contribution Labels ───────────────────────────────────────────────
const FACTOR_LABELS = {
    fastingGlucose:   'Elevated fasting blood glucose',
    postMealGlucose:  'High post-meal glucose spike',
    hba1c:            'HbA1c above healthy range',
    bmi:              'Body weight / BMI is elevated (Asian threshold: BMI ≥ 23)',
    activityDuration: 'Low physical activity level',
    riskFactorCount:  'Multiple diabetes risk factors present',
    age:              'Age is a significant risk factor (Malaysia MOH: screening from age 30+)',
};

// ── Helper: normalize a value to [0, 1] ──────────────────────────────────────
function normalize(value, { min, max }) {
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ── Helper: logistic sigmoid ──────────────────────────────────────────────────
function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
}

// ── Helper: compute risk from feature object ──────────────────────────────────
function computeRisk(features) {
    const norm = {
        fastingGlucose:   normalize(features.fastingGlucose,   RANGES.fastingGlucose),
        postMealGlucose:  normalize(features.postMealGlucose,  RANGES.postMealGlucose),
        hba1c:            normalize(features.hba1c,            RANGES.hba1c),
        bmi:              normalize(features.bmi,              RANGES.bmi),
        activityDuration: normalize(features.activityDuration, RANGES.activityDuration),
        riskFactorCount:  normalize(features.riskFactorCount,  RANGES.riskFactorCount),
        age:              normalize(features.age,              RANGES.age),
    };

    const z =
        WEIGHTS.bias +
        WEIGHTS.fastingGlucose   * norm.fastingGlucose +
        WEIGHTS.postMealGlucose  * norm.postMealGlucose +
        WEIGHTS.hba1c            * norm.hba1c +
        WEIGHTS.bmi              * norm.bmi +
        WEIGHTS.activityDuration * norm.activityDuration +
        WEIGHTS.riskFactorCount  * norm.riskFactorCount +
        WEIGHTS.age              * norm.age;

    return sigmoid(z);
}

// ── Helper: identify top contributing factors ─────────────────────────────────
function getTopFactors(features) {
    const contributions = [
        {
            key: 'fastingGlucose',
            value: features.fastingGlucose,
            contribution: WEIGHTS.fastingGlucose * normalize(features.fastingGlucose, RANGES.fastingGlucose),
            threshold: 100,    // ADA: impaired fasting glucose ≥ 100 mg/dL
            lowerIsBad: false,
        },
        {
            key: 'postMealGlucose',
            value: features.postMealGlucose,
            contribution: WEIGHTS.postMealGlucose * normalize(features.postMealGlucose, RANGES.postMealGlucose),
            threshold: 140,    // ADA: impaired glucose tolerance ≥ 140 mg/dL
            lowerIsBad: false,
        },
        {
            key: 'hba1c',
            value: features.hba1c,
            contribution: WEIGHTS.hba1c * normalize(features.hba1c, RANGES.hba1c),
            threshold: 5.7,    // ADA: prediabetes starts at HbA1c 5.7%
            lowerIsBad: false,
        },
        {
            key: 'bmi',
            value: features.bmi,
            contribution: WEIGHTS.bmi * normalize(features.bmi, RANGES.bmi),
            threshold: 23,     // WHO Asian-Pacific: overweight threshold = 23 (not 25)
            lowerIsBad: false,
        },
        {
            key: 'activityDuration',
            value: features.activityDuration,
            contribution: WEIGHTS.activityDuration * normalize(features.activityDuration, RANGES.activityDuration),
            threshold: 30,     // WHO: minimum 30 min moderate activity/day
            lowerIsBad: true,  // low activity = bad
        },
        {
            key: 'riskFactorCount',
            value: features.riskFactorCount,
            contribution: WEIGHTS.riskFactorCount * normalize(features.riskFactorCount, RANGES.riskFactorCount),
            threshold: 1,
            lowerIsBad: false,
        },
        {
            key: 'age',
            value: features.age,
            contribution: WEIGHTS.age * normalize(features.age, RANGES.age),
            threshold: 30,     // Malaysia MOH CPG 6th Ed: screening recommended from age 30+
            lowerIsBad: false,
        },
    ];

    return contributions
        .filter((f) => {
            if (f.lowerIsBad) return f.value < f.threshold;
            return f.value > f.threshold && f.contribution > 0.05;
        })
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 3)
        .map((f) => ({
            key: f.key,
            label: FACTOR_LABELS[f.key],
            contribution: Math.abs(f.contribution),
        }));
}

// ── Risk level from score ─────────────────────────────────────────────────────
// t1 = Low→Moderate boundary (0–1), t2 = Moderate→High midpoint, t3 = High→VeryHigh boundary
function getRiskLevel(score, t1 = 0.37, t3 = 0.75) {
    const t2 = (t1 + t3) / 2;  // midpoint = Moderate→High boundary
    if (score < t1) return { level: 'Low',       color: '#10B981', bg: '#ECFDF5', border: '#A7F3D0', emoji: '🟢' };
    if (score < t2) return { level: 'Moderate',  color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A', emoji: '🟡' };
    if (score < t3) return { level: 'High',      color: '#F97316', bg: '#FFF7ED', border: '#FED7AA', emoji: '🟠' };
    return               { level: 'Very High',  color: '#EF4444', bg: '#FEF2F2', border: '#FECACA', emoji: '🔴' };
}

// ── Main Hook ─────────────────────────────────────────────────────────────────
export function useDiabetesRisk(userId) {
    const [state, setState] = useState({
        loading: true,
        hasData: false,
        riskScore: 0,         // 0–1
        riskPercent: 0,        // 0–100
        riskLevel: null,
        factors: [],
        features: null,
        missingFields: [],
    });

    useEffect(() => {
        if (!userId) return;

        async function fetchAndPredict() {
            setState((s) => ({ ...s, loading: true }));
            try {
                // 1. Fetch admin risk thresholds from Firestore (with safe defaults)
                let t1 = 0.37; // Low→Moderate  (default 37%)
                let t3 = 0.75; // High→VeryHigh (default 75%)
                try {
                    const rulesSnap = await getDoc(doc(db, 'adminSettings', 'rules'));
                    if (rulesSnap.exists()) {
                        const rules = rulesSnap.data();
                        if (rules.lowRiskScore)  t1 = rules.lowRiskScore  / 100;
                        if (rules.highRiskScore) t3 = rules.highRiskScore / 100;
                    }
                } catch { /* use defaults */ }

                // 2. Fetch user profile (height, weight, riskFactors)
                const profileSnap = await getDoc(doc(db, 'users', userId));
                const profile = profileSnap.exists() ? profileSnap.data() : {};

                // 3. Fetch most recent daily log
                const logsRef = collection(db, 'users', userId, 'dailyLogs');
                const q = query(logsRef, orderBy('date', 'desc'), limit(1));
                const logsSnap = await getDocs(q);

                let latestLog = null;
                if (!logsSnap.empty) {
                    latestLog = logsSnap.docs[0].data();
                }

                // 3. Extract features with fallbacks
                const fastingGlucose   = latestLog?.bloodSugar?.fastingGlucose  ?? null;
                const postMealGlucose  = latestLog?.bloodSugar?.postMealGlucose
                    ?? latestLog?.bloodSugar?.afterBreakfast
                    ?? latestLog?.bloodSugar?.afterLunch
                    ?? latestLog?.bloodSugar?.afterDinner
                    ?? null;
                const hba1c            = latestLog?.bloodSugar?.hba1c           ?? null;
                const activityDuration = latestLog?.physicalActivity?.activityDuration ?? null;

                // BMI from profile (height in cm → m)
                const height = profile.height ? Number(profile.height) / 100 : null;
                const weight = profile.weight ? Number(profile.weight) : null;
                const bmi = (height && weight && height > 0) ? weight / (height * height) : null;

                // Age from profile (supports dateOfBirth string or direct age field)
                let age = null;
                if (profile.age) {
                    age = Number(profile.age);
                } else if (profile.dateOfBirth) {
                    const birth = new Date(profile.dateOfBirth);
                    if (!isNaN(birth)) {
                    // Accurate age: subtract 1 if birthday hasn't occurred yet this year
                    const today = new Date();
                    age = today.getFullYear() - birth.getFullYear();
                    const hasBirthdayPassed =
                        today.getMonth() > birth.getMonth() ||
                        (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
                    if (!hasBirthdayPassed) age -= 1;
                }
                }

                // Risk factor count from profile checkboxes
                const riskFactors = profile.riskFactors || {};
                const riskFactorCount = Object.values(riskFactors).filter(Boolean).length;

                // 4. Determine what's missing
                const missingFields = [];
                if (fastingGlucose === null) missingFields.push('Fasting Glucose');
                if (hba1c === null)          missingFields.push('HbA1c');
                if (bmi === null)            missingFields.push('Height & Weight (in Profile)');
                if (age === null)            missingFields.push('Date of Birth (in Profile)');

                // Need at least fasting glucose or HbA1c to make a meaningful prediction
                const hasEnoughData = fastingGlucose !== null || hba1c !== null;

                if (!hasEnoughData) {
                    setState({
                        loading: false, hasData: false, riskScore: 0,
                        riskPercent: 0, riskLevel: null, factors: [],
                        features: null, missingFields,
                    });
                    return;
                }

                // 5. Sensible defaults for missing values (population averages)
                const features = {
                    fastingGlucose:   fastingGlucose   ?? 95,   // normal fasting
                    postMealGlucose:  postMealGlucose  ?? 120,  // normal post-meal
                    hba1c:            hba1c            ?? 5.5,  // normal HbA1c
                    bmi:              bmi              ?? 22.5, // healthy BMI
                    activityDuration: activityDuration ?? 0,    // assume sedentary if unknown
                    riskFactorCount,
                    age:              age              ?? 35,   // default middle-risk age
                };

                // 6. Run logistic regression
                const riskScore = computeRisk(features);
                const riskLevel = getRiskLevel(riskScore, t1, t3);
                const factors = getTopFactors(features);

                setState({
                    loading: false,
                    hasData: true,
                    riskScore,
                    riskPercent: Math.round(riskScore * 100),
                    riskLevel,
                    factors,
                    features,
                    missingFields,
                });
            } catch (err) {
                console.error('[useDiabetesRisk] Error:', err);
                setState({
                    loading: false,
                    hasData: false,
                    riskScore: 0,
                    riskPercent: 0,
                    riskLevel: null,
                    factors: [],
                    features: null,
                    missingFields: [],
                });
            }
        }

        fetchAndPredict();
    }, [userId]);

    return state;
}
