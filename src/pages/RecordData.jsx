import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, updateDoc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { logEvent } from '../utils/logEvent';
import Sidebar from '../components/Sidebar';
import TopHeader from '../components/TopHeader';
import '../dashboard.css';
import '../record.css';

const activityTypes = [
    'Walking', 'Running', 'Cycling', 'Swimming', 'Yoga',
    'Gym / Weight training', 'Sports', 'Dancing', 'Other',
];

const testTimes = [
    'Fasting (morning, before eating)',
    'Before breakfast',
    'After breakfast (2h)',
    'Before lunch',
    'After lunch (2h)',
    'Before dinner',
    'After dinner (2h)',
    'Bedtime',
];

// Maps each test time label → Firestore field key
const TIME_SLOT_KEYS = {
    'Fasting (morning, before eating)': 'fastingGlucose',
    'Before breakfast':                 'beforeBreakfast',
    'After breakfast (2h)':             'afterBreakfast',
    'Before lunch':                     'beforeLunch',
    'After lunch (2h)':                 'afterLunch',
    'Before dinner':                    'beforeDinner',
    'After dinner (2h)':                'afterDinner',
    'Bedtime':                          'bedtimeGlucose',
};

// Reverse map: Firestore key → display label
const SLOT_LABELS = Object.fromEntries(
    Object.entries(TIME_SLOT_KEYS).map(([label, key]) => [key, label])
);

// Which slot keys are post-meal (for backward compat)
const POST_MEAL_KEYS = new Set(['afterBreakfast', 'afterLunch', 'afterDinner']);

function today() {
    return new Date().toISOString().slice(0, 10);
}

// ── Malaysian Local Food Database ────────────────────────────────────────────
// Nutritional values per 100g, sourced from:
// Ministry of Health Malaysia (MOH) Nutritional Composition Database &
// Malaysian Food Composition Database (MFCD)
const LOCAL_MY_FOODS = [
    // ── Rice & Noodles ───────────────────────────────────────────────────────
    { name: 'Nasi Lemak (with sambal, egg & ikan bilis)', category: 'Rice', calories: 197, carbs: 24.8, sugar: 2.1, fiber: 1.3 },
    { name: 'Nasi Goreng (Fried Rice)', category: 'Rice', calories: 163, carbs: 22.1, sugar: 1.2, fiber: 0.8 },
    { name: 'Nasi Putih (Steamed White Rice)', category: 'Rice', calories: 130, carbs: 28.2, sugar: 0.1, fiber: 0.3 },
    { name: 'Nasi Briyani', category: 'Rice', calories: 174, carbs: 25.6, sugar: 1.4, fiber: 0.9 },
    { name: 'Mee Goreng (Fried Noodles)', category: 'Noodles', calories: 138, carbs: 21.4, sugar: 2.8, fiber: 1.1 },
    { name: 'Mee Goreng Mamak', category: 'Noodles', calories: 152, carbs: 23.0, sugar: 3.2, fiber: 1.2 },
    { name: 'Char Kway Teow', category: 'Noodles', calories: 165, carbs: 22.5, sugar: 1.8, fiber: 1.0 },
    { name: 'Laksa', category: 'Noodles', calories: 119, carbs: 14.2, sugar: 2.6, fiber: 1.5 },
    { name: 'Bak Kut Teh', category: 'Soup', calories: 92, carbs: 1.8, sugar: 0.5, fiber: 0.3 },
    { name: 'Wantan Mee', category: 'Noodles', calories: 127, carbs: 19.8, sugar: 1.1, fiber: 0.7 },
    { name: 'Mihun Goreng (Fried Vermicelli)', category: 'Noodles', calories: 141, carbs: 22.9, sugar: 1.5, fiber: 0.8 },
    { name: 'Pan Mee', category: 'Noodles', calories: 122, carbs: 18.4, sugar: 0.8, fiber: 0.9 },
    // ── Bread & Roti ─────────────────────────────────────────────────────────
    { name: 'Roti Canai (Plain)', category: 'Bread', calories: 301, carbs: 42.5, sugar: 1.3, fiber: 1.6 },
    { name: 'Roti Canai with Dal Curry', category: 'Bread', calories: 215, carbs: 31.0, sugar: 2.0, fiber: 2.1 },
    { name: 'Capati', category: 'Bread', calories: 238, carbs: 40.1, sugar: 1.0, fiber: 3.8 },
    { name: 'Tosai / Thosai', category: 'Bread', calories: 168, carbs: 30.5, sugar: 1.2, fiber: 1.1 },
    { name: 'Roti Bakar (Toast with Kaya & Butter)', category: 'Bread', calories: 285, carbs: 38.2, sugar: 14.5, fiber: 1.4 },
    // ── Protein / Dishes ─────────────────────────────────────────────────────
    { name: 'Ayam Goreng (Fried Chicken)', category: 'Protein', calories: 246, carbs: 6.4, sugar: 0.4, fiber: 0.2 },
    { name: 'Rendang Ayam (Chicken Rendang)', category: 'Protein', calories: 178, carbs: 4.2, sugar: 1.8, fiber: 1.0 },
    { name: 'Rendang Daging (Beef Rendang)', category: 'Protein', calories: 195, carbs: 3.8, sugar: 1.5, fiber: 0.9 },
    { name: 'Ikan Goreng (Fried Fish)', category: 'Protein', calories: 196, carbs: 4.8, sugar: 0.2, fiber: 0.1 },
    { name: 'Ikan Bakar (Grilled Fish)', category: 'Protein', calories: 136, carbs: 1.2, sugar: 0.3, fiber: 0.0 },
    { name: 'Sambal Udang (Prawn Sambal)', category: 'Protein', calories: 142, carbs: 6.5, sugar: 3.2, fiber: 1.3 },
    { name: 'Telur Goreng (Fried Egg)', category: 'Protein', calories: 196, carbs: 0.6, sugar: 0.4, fiber: 0.0 },
    { name: 'Tauhu Goreng (Fried Tofu)', category: 'Protein', calories: 175, carbs: 4.8, sugar: 0.8, fiber: 0.4 },
    { name: 'Satay (Chicken, with peanut sauce)', category: 'Protein', calories: 193, carbs: 8.5, sugar: 3.1, fiber: 1.2 },
    // ── Vegetables ───────────────────────────────────────────────────────────
    { name: 'Kangkung Belacan (Stir-fry Water Spinach)', category: 'Vegetables', calories: 42, carbs: 4.5, sugar: 1.2, fiber: 2.1 },
    { name: 'Sayur Campur (Mixed Vegetables)', category: 'Vegetables', calories: 38, carbs: 5.8, sugar: 2.4, fiber: 2.5 },
    { name: 'Dalca (Lentil & Vegetable Curry)', category: 'Vegetables', calories: 88, carbs: 11.2, sugar: 2.8, fiber: 3.4 },
    // ── Kuih & Snacks ────────────────────────────────────────────────────────
    { name: 'Kuih Lapis', category: 'Kuih', calories: 193, carbs: 38.4, sugar: 18.2, fiber: 0.5 },
    { name: 'Kuih Dadar (Pandan Crepe)', category: 'Kuih', calories: 205, carbs: 32.1, sugar: 16.8, fiber: 1.2 },
    { name: 'Ondeh-Ondeh', category: 'Kuih', calories: 188, carbs: 36.2, sugar: 14.5, fiber: 1.0 },
    { name: 'Pisang Goreng (Banana Fritter)', category: 'Snack', calories: 218, carbs: 34.8, sugar: 12.6, fiber: 1.8 },
    { name: 'Cucur Udang (Prawn Fritter)', category: 'Snack', calories: 231, carbs: 26.4, sugar: 1.2, fiber: 0.9 },
    { name: 'Karipap (Curry Puff)', category: 'Snack', calories: 258, carbs: 28.5, sugar: 1.8, fiber: 1.4 },
    // ── Drinks ───────────────────────────────────────────────────────────────
    { name: 'Teh Tarik (Pulled Milk Tea, sweetened)', category: 'Drinks', calories: 68, carbs: 10.2, sugar: 9.8, fiber: 0.0 },
    { name: 'Teh O (Black Tea, sweetened)', category: 'Drinks', calories: 42, carbs: 10.5, sugar: 10.2, fiber: 0.0 },
    { name: 'Kopi O (Black Coffee, sweetened)', category: 'Drinks', calories: 45, carbs: 9.8, sugar: 9.5, fiber: 0.0 },
    { name: 'Milo (Nestle Milo, made with milk)', category: 'Drinks', calories: 124, carbs: 18.2, sugar: 14.6, fiber: 0.4 },
    { name: 'Sirap Bandung (Rose Syrup with Milk)', category: 'Drinks', calories: 88, carbs: 18.5, sugar: 17.8, fiber: 0.0 },
    { name: 'Coconut Water (Air Kelapa)', category: 'Drinks', calories: 19, carbs: 3.7, sugar: 2.6, fiber: 1.1 },
    { name: 'Soya Bean Drink (Air Soya)', category: 'Drinks', calories: 54, carbs: 5.8, sugar: 4.9, fiber: 0.2 },
    // ── Fruits ───────────────────────────────────────────────────────────────
    { name: 'Durian', category: 'Fruit', calories: 147, carbs: 27.1, sugar: 19.5, fiber: 3.8 },
    { name: 'Mangga / Mango', category: 'Fruit', calories: 60, carbs: 14.8, sugar: 13.7, fiber: 1.6 },
    { name: 'Pisang / Banana', category: 'Fruit', calories: 89, carbs: 22.8, sugar: 12.2, fiber: 2.6 },
    { name: 'Betik / Papaya', category: 'Fruit', calories: 43, carbs: 10.8, sugar: 7.8, fiber: 1.7 },
    { name: 'Tembikai / Watermelon', category: 'Fruit', calories: 30, carbs: 7.6, sugar: 6.2, fiber: 0.4 },
    { name: 'Rambutan', category: 'Fruit', calories: 68, carbs: 16.5, sugar: 15.0, fiber: 0.9 },
    { name: 'Jambu Batu / Guava', category: 'Fruit', calories: 68, carbs: 14.3, sugar: 8.9, fiber: 5.4 },
    // ── Soup / One-dish ──────────────────────────────────────────────────────
    { name: 'Sup Ayam (Chicken Soup)', category: 'Soup', calories: 58, carbs: 2.4, sugar: 0.8, fiber: 0.4 },
    { name: 'Bubur Ayam (Chicken Congee)', category: 'Porridge', calories: 68, carbs: 11.2, sugar: 0.4, fiber: 0.3 },
    { name: 'Asam Pedas (Sour Spicy Fish Stew)', category: 'Soup', calories: 95, carbs: 5.8, sugar: 3.4, fiber: 1.5 },
];

// ── Local food fuzzy search ──────────────────────────────────────────────────
function searchLocalFoods(query) {
    const q = query.toLowerCase().trim();
    return LOCAL_MY_FOODS
        .filter((f) =>
            f.name.toLowerCase().includes(q) ||
            f.category.toLowerCase().includes(q)
        )
        .slice(0, 6)
        .map((f) => ({ ...f, source: 'local', brand: `MOH Malaysia · ${f.category}` }));
}

// ── Open Food Facts + Local Fallback search ──────────────────────────────────
async function searchFood(query) {
    if (!query || query.trim().length < 2) return [];
    try {
        const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query.trim())}&search_simple=1&action=process&json=1&page_size=6&fields=product_name,nutriments,brands,serving_size`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const apiResults = (data.products || [])
            .filter((p) => p.product_name && p.product_name.trim())
            .map((p) => ({
                name: p.product_name.trim(),
                brand: p.brands || '',
                servingSize: p.serving_size || '100g',
                source: 'api',
                calories: Math.round(p.nutriments?.['energy-kcal_100g'] ?? p.nutriments?.['energy-kcal'] ?? 0) || null,
                carbs: p.nutriments?.carbohydrates_100g != null ? parseFloat(p.nutriments.carbohydrates_100g.toFixed(1)) : null,
                sugar: p.nutriments?.sugars_100g != null ? parseFloat(p.nutriments.sugars_100g.toFixed(1)) : null,
                fiber: p.nutriments?.fiber_100g != null ? parseFloat(p.nutriments.fiber_100g.toFixed(1)) : null,
            }));
        // If API found results, return them; otherwise fall back to local
        if (apiResults.length > 0) return apiResults;
    } catch { /* fall through to local */ }
    // Fallback: local Malaysian database
    return searchLocalFoods(query);
}

// ── Food Search Widget ───────────────────────────────────────────────────────
function FoodSearchWidget({ mealKey, onSelect }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [usedFallback, setUsedFallback] = useState(false);
    const debounceRef = useRef(null);
    const wrapRef = useRef(null);

    const doSearch = useCallback((q) => {
        clearTimeout(debounceRef.current);
        if (!q || q.trim().length < 2) { setResults([]); setOpen(false); return; }
        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            const found = await searchFood(q);
            setUsedFallback(found.length > 0 && found[0]?.source === 'local');
            setResults(found);
            setOpen(found.length > 0);
            setLoading(false);
        }, 500);
    }, []);

    const handleChange = (e) => {
        const val = e.target.value;
        setQuery(val);
        doSearch(val);
    };

    const handleSelect = (item) => {
        onSelect(item);
        setQuery('');
        setResults([]);
        setOpen(false);
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handler = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div className="food-search-wrap" ref={wrapRef}>
            <div className="food-search-input-row">
                <span className="food-search-icon">🔍</span>
                <input
                    type="text"
                    className="food-search-input"
                    placeholder={`Search food database for ${mealKey}…`}
                    value={query}
                    onChange={handleChange}
                    onFocus={() => results.length > 0 && setOpen(true)}
                    autoComplete="off"
                    id={`food-search-${mealKey}`}
                />
                {loading && <span className="food-search-spinner" />}
            </div>

            {open && results.length > 0 && (
                <ul className="food-search-dropdown" role="listbox">
                    {usedFallback && (
                        <li className="food-search-section-header">
                            🇲🇾 Malaysian Local Foods (MOH Database)
                        </li>
                    )}
                    {results.map((item, i) => (
                        <li
                            key={i}
                            className="food-search-item"
                            role="option"
                            onMouseDown={() => handleSelect(item)}
                        >
                            <div className="food-item-name">
                                {item.name}
                                <span className={`food-source-tag ${item.source === 'local' ? 'local' : 'api'}`}>
                                    {item.source === 'local' ? '🇲🇾 MY' : '🌐 API'}
                                </span>
                            </div>
                            {item.brand && (
                                <div className="food-item-brand-row">{item.brand.split(',')[0]}</div>
                            )}
                            <div className="food-item-macros">
                                {item.calories != null && <span className="macro-badge cal">🔥 {item.calories} kcal</span>}
                                {item.carbs != null && <span className="macro-badge carb">🌾 {item.carbs}g carbs</span>}
                                {item.sugar != null && <span className="macro-badge sugar">🍬 {item.sugar}g sugar</span>}
                                <span className="macro-badge serving">per 100g</span>
                            </div>
                        </li>
                    ))}
                    <li className="food-search-credit">
                        {usedFallback ? (
                            <span>📚 Source: MOH Malaysia Nutritional Composition Database</span>
                        ) : (
                            <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">
                                Powered by Open Food Facts
                            </a>
                        )}
                    </li>
                </ul>
            )}
        </div>
    );
}

// ── Nutrition Summary Badge ──────────────────────────────────────────────────
function NutritionBadge({ info, onClear }) {
    if (!info) return null;
    return (
        <div className="nutrition-badge">
            <div className="nutrition-badge-name">
                <span>📋 {info.name}</span>
                <button className="nutrition-clear-btn" onClick={onClear} title="Clear nutrition info">✕</button>
            </div>
            <div className="nutrition-macros">
                {info.calories != null && <span className="macro-badge cal">🔥 {info.calories} kcal</span>}
                {info.carbs   != null && <span className="macro-badge carb">🌾 {info.carbs}g carbs</span>}
                {info.sugar   != null && <span className="macro-badge sugar">🍬 {info.sugar}g sugar</span>}
                {info.fiber   != null && <span className="macro-badge fiber">🥦 {info.fiber}g fiber</span>}
                <span className="macro-badge serving">per 100g</span>
            </div>
        </div>
    );
}

// ── Toast Notification Component ────────────────────────────────────────────
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
                    <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">✕</button>
                    <div className="toast-progress" style={{ animationDuration: `${t.duration}ms` }} />
                </div>
            ))}
        </div>
    );
}

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

// ── Main Component ───────────────────────────────────────────────────────────
export default function RecordData() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    // Toast notifications
    const { toasts, showToast, dismiss } = useToast();

    // Live today's glucose readings (from Firestore)
    const [todayReadings, setTodayReadings] = useState({});

    const [form, setForm] = useState({
        date: today(),
        // Blood Sugar — single reading routed to fasting or post-meal on save
        glucoseReading: '',
        hba1c: '',
        testTime: '',
        // Food Intake
        breakfast: '',
        lunch: '',
        dinner: '',
        snacks: '',
        waterIntake: '',
        // Physical Activity
        dailySteps: '',
        activityDuration: '',
        activityType: '',
        activityTypeOther: '', // free-text when 'Other' is selected
        // Body Measurement
        weight: '',
        notes: '',
    });

    // Nutrition info per meal slot
    const [nutrition, setNutrition] = useState({
        breakfast: null,
        lunch: null,
        dinner: null,
        snacks: null,
    });

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            if (!u) { navigate('/login'); return; }
            setUser(u);
        });
        return () => unsub();
    }, [navigate]);

    // ── Live snapshot of today's glucose readings ───────────────────────────
    useEffect(() => {
        if (!user) return;
        const ref = doc(db, 'users', user.uid, 'dailyLogs', form.date);
        const unsub = onSnapshot(ref, (snap) => {
            if (snap.exists()) {
                setTodayReadings(snap.data()?.bloodSugar || {});
            } else {
                setTodayReadings({});
            }
        });
        return () => unsub();
    }, [user, form.date]);

    // ── Pre-populate form from Firestore when date changes ──────────────────
    // This ensures that if the user already saved breakfast, it shows up
    // when they come back to add lunch/dinner — preventing accidental overwrites.
    useEffect(() => {
        if (!user) return;
        const ref = doc(db, 'users', user.uid, 'dailyLogs', form.date);
        getDoc(ref).then((snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            const fi = data.foodIntake || {};
            const pa = data.physicalActivity || {};
            const bm = data.bodyMeasurement || {};
            const bs = data.bloodSugar || {};
            setForm((prev) => ({
                ...prev,
                breakfast:        fi.breakfast         ?? prev.breakfast,
                lunch:            fi.lunch             ?? prev.lunch,
                dinner:           fi.dinner            ?? prev.dinner,
                snacks:           fi.snacks            ?? prev.snacks,
                waterIntake:      fi.waterIntake != null ? String(fi.waterIntake) : prev.waterIntake,
                dailySteps:       pa.dailySteps != null ? String(pa.dailySteps) : prev.dailySteps,
                activityDuration: pa.activityDuration != null ? String(pa.activityDuration) : prev.activityDuration,
                activityType:     pa.activityType     ?? prev.activityType,
                weight:           bm.weight != null ? String(bm.weight) : prev.weight,
                notes:            bm.notes            ?? prev.notes,
                hba1c:            bs.hba1c != null ? String(bs.hba1c) : prev.hba1c,
            }));
            // Restore nutrition info badges if previously saved
            if (fi.nutritionInfo) {
                setNutrition((prev) => ({
                    ...prev,
                    ...Object.fromEntries(
                        Object.entries(fi.nutritionInfo).map(([meal, info]) => [
                            meal,
                            info ? { name: info.foodName, calories: info.calories, carbs: info.carbs, sugar: info.sugar, fiber: info.fiber } : null,
                        ])
                    ),
                }));
            }
        }).catch(() => {});
    // Only re-run when user or date changes, NOT on every keystroke
    }, [user, form.date]);



    const set = (field) => (e) => {
        setForm((f) => ({ ...f, [field]: e.target.value }));
        setSaved(false); setError('');
    };

    const handleFoodSelect = (mealKey, item) => {
        // Auto-fill the meal text field with the food name
        setForm((f) => ({
            ...f,
            [mealKey]: f[mealKey]
                ? `${f[mealKey]}, ${item.name}`
                : item.name,
        }));
        // Store nutrition info
        setNutrition((n) => ({ ...n, [mealKey]: item }));
        setSaved(false);
    };

    const clearNutrition = (mealKey) => {
        setNutrition((n) => ({ ...n, [mealKey]: null }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setError('');

        // ── Validation ───────────────────────────────────────────────────────
        const errs = [];

        // 1. Date is always required
        if (!form.date) {
            errs.push('Please select a date for this record.');
        }

        // 2. At least one meaningful data field must be filled
        const hasBloodSugar    = form.glucoseReading || form.hba1c;
        const hasFoodIntake    = form.breakfast || form.lunch || form.dinner || form.snacks || form.waterIntake;
        const hasActivity      = form.dailySteps || form.activityDuration;
        const hasMeasurement   = form.weight || form.notes;

        if (!hasBloodSugar && !hasFoodIntake && !hasActivity && !hasMeasurement) {
            errs.push('Please fill in at least one field before saving. The form cannot be saved empty.');
        }

        // 3. Cross-field: glucose value requires a test time (and vice-versa)
        if (form.glucoseReading && !form.testTime) {
            errs.push('You entered a glucose reading — please also select a Test Time so it can be classified correctly.');
        }
        if (form.testTime && !form.glucoseReading) {
            errs.push('You selected a Test Time but did not enter a glucose reading. Please enter a glucose value or clear the Test Time.');
        }

        // 4. Numeric range checks
        const glu = Number(form.glucoseReading);
        if (form.glucoseReading !== '' && (isNaN(glu) || glu < 20 || glu > 600)) {
            errs.push('Glucose reading must be between 20 and 600 mg/dL. Please check your entry.');
        }

        const hba = Number(form.hba1c);
        if (form.hba1c !== '' && (isNaN(hba) || hba < 3 || hba > 20)) {
            errs.push('HbA1c must be between 3% and 20%. Please check your entry.');
        }

        const steps = Number(form.dailySteps);
        if (form.dailySteps !== '' && (isNaN(steps) || steps < 0 || steps > 100000)) {
            errs.push('Daily steps must be between 0 and 100,000. Please check your entry.');
        }

        const dur = Number(form.activityDuration);
        if (form.activityDuration !== '' && (isNaN(dur) || dur < 0 || dur > 1440)) {
            errs.push('Activity duration must be between 0 and 1,440 minutes (24 hours). Please check your entry.');
        }

        const water = Number(form.waterIntake);
        if (form.waterIntake !== '' && (isNaN(water) || water < 0 || water > 50)) {
            errs.push('Water intake must be between 0 and 50 glasses. Please check your entry.');
        }

        const wt = Number(form.weight);
        if (form.weight !== '' && (isNaN(wt) || wt < 10 || wt > 300)) {
            errs.push('Weight must be between 10 and 300 kg. Please check your entry.');
        }

        // 5. If 'Other' activity type chosen, a description is required
        if (form.activityType === 'Other' && !form.activityTypeOther.trim()) {
            errs.push('You selected "Other" as the activity type — please describe what activity you did.');
        }

        // Stop here if any validation errors found
        if (errs.length > 0) {
            setError(errs.join('\n'));
            return;
        }

        // ── Save ─────────────────────────────────────────────────────────────
        setSaving(true);

        try {
            const ref = doc(db, 'users', user.uid, 'dailyLogs', form.date);

            // ── Build bloodSugar update — only set the specific slot, never null others──
            const glucoseNum = form.glucoseReading ? Number(form.glucoseReading) : null;
            const slotKey    = TIME_SLOT_KEYS[form.testTime] ?? null;

            const bloodSugarUpdate = {};
            if (glucoseNum !== null && slotKey) {
                // bloodSugarUpdate[slotKey] handles all slots including 'fastingGlucose'.
                // When slotKey === 'fastingGlucose' this is the only write needed (no duplicate).
                bloodSugarUpdate[slotKey] = glucoseNum;
            }
            if (form.hba1c) bloodSugarUpdate.hba1c = Number(form.hba1c);
            if (form.testTime) bloodSugarUpdate.lastTestTime = form.testTime;

            // ── Step 1: Ensure the document exists with base fields.
            // setDoc(merge:true) is safe for top-level scalar fields.
            // We use this to stamp the date and savedAt WITHOUT dot-notation nested keys,
            // because setDoc does NOT interpret dots as nested paths (only updateDoc does).
            await setDoc(ref, { date: form.date, savedAt: serverTimestamp() }, { merge: true });

            // ── Step 2: Build a dot-notation update payload for all NESTED fields.
            // updateDoc() correctly interprets 'a.b' as { a: { b: ... } } at the
            // field level — so it merges per-field without overwriting sibling fields.
            const nestedUpdate = {};

            // bloodSugar: only write the specific slot that was filled
            Object.entries(bloodSugarUpdate).forEach(([k, v]) => {
                nestedUpdate[`bloodSugar.${k}`] = v;
            });

            // foodIntake: only write a field if the user filled it in this session
            if (form.breakfast)   nestedUpdate['foodIntake.breakfast']  = form.breakfast;
            if (form.lunch)       nestedUpdate['foodIntake.lunch']      = form.lunch;
            if (form.dinner)      nestedUpdate['foodIntake.dinner']     = form.dinner;
            if (form.snacks)      nestedUpdate['foodIntake.snacks']     = form.snacks;
            if (form.waterIntake) nestedUpdate['foodIntake.waterIntake'] = Number(form.waterIntake);

            // nutrition info: only write per-meal nutrition if a food was selected
            ['breakfast', 'lunch', 'dinner', 'snacks'].forEach((meal) => {
                if (nutrition[meal]) {
                    nestedUpdate[`foodIntake.nutritionInfo.${meal}`] = {
                        foodName: nutrition[meal].name,
                        calories: nutrition[meal].calories,
                        carbs:    nutrition[meal].carbs,
                        sugar:    nutrition[meal].sugar,
                        fiber:    nutrition[meal].fiber,
                    };
                }
            });

            // physicalActivity: only write filled fields
            if (form.dailySteps)       nestedUpdate['physicalActivity.dailySteps']       = Number(form.dailySteps);
            if (form.activityDuration) nestedUpdate['physicalActivity.activityDuration'] = Number(form.activityDuration);
            if (form.activityType)     nestedUpdate['physicalActivity.activityType']     = form.activityType === 'Other'
                ? (form.activityTypeOther.trim() || 'Other')
                : form.activityType;

            // bodyMeasurement: only write filled fields
            if (form.weight) nestedUpdate['bodyMeasurement.weight'] = Number(form.weight);
            if (form.notes)  nestedUpdate['bodyMeasurement.notes']  = form.notes;

            // Only call updateDoc if there are nested fields to write
            if (Object.keys(nestedUpdate).length > 0) {
                await updateDoc(ref, nestedUpdate);
            }

            setSaved(true);

            const isHighGlucose = glucoseNum && glucoseNum > 180;
            await logEvent(db, {
                level: isHighGlucose ? 'WARNING' : 'SUCCESS',
                category: 'Data Entry',
                user: user.email,
                message: isHighGlucose
                    ? `High glucose reading recorded: ${glucoseNum} mg/dL (${form.date})`
                    : `Daily health data recorded for ${form.date}`,
            });

            // ── Toast feedback ──────────────────────────────────────────────
            if (isHighGlucose) {
                showToast({
                    type: 'warning',
                    icon: '⚠️',
                    title: 'High Glucose Detected!',
                    desc: `Your reading of ${glucoseNum} mg/dL is above the 180 mg/dL threshold. Consider consulting your healthcare provider.`,
                    duration: 7000,
                });
            } else {
                showToast({
                    type: 'success',
                    icon: '✅',
                    title: 'Record saved successfully!',
                    desc: `Your health data for ${form.date} has been recorded.`,
                    duration: 4500,
                });
            }
        } catch (err) {
            if (err.code === 'permission-denied') {
                setError('Save failed: You do not have permission. Please log out and log in again.');
                showToast({ type: 'error', icon: '❌', title: 'Permission Denied', desc: 'Please log out and log in again.', duration: 6000 });
            } else {
                setError('Failed to save: ' + err.message);
                showToast({ type: 'error', icon: '❌', title: 'Save Failed', desc: err.message, duration: 6000 });
            }
        } finally {
            setSaving(false);
        }
    };

    const mealFields = [
        { field: 'breakfast', label: 'Breakfast', ph: 'e.g., Oatmeal with berries, whole grain toast' },
        { field: 'lunch',     label: 'Lunch',     ph: 'e.g., Grilled chicken salad, brown rice' },
        { field: 'dinner',    label: 'Dinner',     ph: 'e.g., Baked salmon, steamed vegetables' },
        { field: 'snacks',    label: 'Snacks',     ph: 'e.g., Almonds, apple, yogurt' },
    ];

    return (
        <div className="db-layout">
            <ToastContainer toasts={toasts} onDismiss={dismiss} />
            <Sidebar />

            <div className="db-main">
                <TopHeader user={user} />

                <div className="db-body">
                    <div>
                        <div className="db-page-title">Record lifestyle data</div>
                        <div className="db-page-sub">Track your daily food intake, activity, and measurements</div>
                    </div>

                    <form onSubmit={handleSave} className="record-form" noValidate>

                        {/* ── Date ────────────────────────────────────── */}
                        <div className="rec-card">
                            <div className="rec-field-group">
                                <label className="rec-label">Select Date</label>
                                <input
                                    type="date"
                                    className="rec-input"
                                    value={form.date}
                                    max={today()}
                                    onChange={set('date')}
                                    style={{ maxWidth: 220 }}
                                />
                                <div className="rec-hint">Choose the date for the record</div>
                            </div>
                        </div>

                        {/* ── Blood Sugar ──────────────────────────────── */}
                        <div className="rec-card">
                            <div className="rec-section-header">
                                <div className="rec-section-icon blood">🩸</div>
                                <div>
                                    <div className="rec-section-title">Blood Sugar Tracking</div>
                                    <div className="rec-section-sub">Monitor your glucose levels</div>
                                </div>
                            </div>

                            {/* 2-column grid: adaptive glucose field + test time */}
                            <div className="rec-grid-2">
                                {/* Unified glucose input — adapts label & hint to selected Test Time */}
                                {(() => {
                                    const t = form.testTime;
                                    const isAfter  = t.startsWith('After');
                                    const isFast   = t === 'Fasting (morning, before eating)';
                                    const isBefore = t.startsWith('Before');
                                    const isBed    = t === 'Bedtime';

                                    let glLabel = 'Glucose Reading (mg/dL)';
                                    let glHint  = 'Normal range varies by test time';
                                    let glPh    = 'e.g., 100';

                                    if (isFast)   { glLabel = 'Fasting Glucose (mg/dL)';   glHint = 'Normal: 70–99 mg/dL · Prediabetes: 100–125 · Diabetes: ≥126 (ADA 2024)'; glPh = 'e.g., 95';  }
                                    if (isBefore) { glLabel = 'Pre-Meal Glucose (mg/dL)';  glHint = 'ADA target: 80–130 mg/dL before a meal (for people with diabetes)';         glPh = 'e.g., 110'; }
                                    if (isAfter)  { glLabel = 'Post-Meal Glucose (mg/dL)'; glHint = 'Normal: <140 mg/dL · ADA target for diabetes: <180 mg/dL (2h after meal)'; glPh = 'e.g., 120'; }
                                    if (isBed)    { glLabel = 'Bedtime Glucose (mg/dL)';   glHint = 'ADA target: 100–140 mg/dL at bedtime (for people with diabetes)';           glPh = 'e.g., 115'; }

                                    return (
                                        <div className="rec-field-group">
                                            <label className="rec-label">{glLabel}</label>
                                            <input
                                                type="number"
                                                className="rec-input"
                                                placeholder={glPh}
                                                value={form.glucoseReading}
                                                onChange={set('glucoseReading')}
                                                min="0"
                                            />
                                            <div className="rec-hint">{glHint}</div>
                                        </div>
                                    );
                                })()}

                                <div className="rec-field-group">
                                    <label className="rec-label">Test Time</label>
                                    <select className="rec-input rec-select" value={form.testTime} onChange={set('testTime')}>
                                        <option value="">Select time</option>
                                        {testTimes.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <div className="rec-hint">When did you take the measurement?</div>
                                </div>
                            </div>

                            {/* Today's Glucose Log — live tracker */}
                            {(() => {
                                const filled = Object.entries(TIME_SLOT_KEYS).filter(
                                    ([, key]) => todayReadings[key] != null
                                );
                                return filled.length > 0 ? (
                                    <div className="today-glucose-log">
                                        <div className="today-glucose-title">
                                            📊 Today's Glucose Log
                                            <span className="today-glucose-count">{filled.length}/8 readings</span>
                                        </div>
                                        <div className="today-glucose-grid">
                                            {Object.entries(TIME_SLOT_KEYS).map(([label, key]) => {
                                                const val = todayReadings[key];
                                                const done = val != null;
                                                const isHigh = done && val > 180;
                                                const isWarning = done && val > 140 && val <= 180;
                                                return (
                                                    <div key={key} className={`today-glucose-slot ${done ? 'slot-done' : 'slot-empty'}`}>
                                                        <div className="slot-label">{label}</div>
                                                        <div className={`slot-val ${isHigh ? 'val-high' : isWarning ? 'val-warn' : done ? 'val-ok' : 'val-none'}`}>
                                                            {done ? `${val} mg/dL` : '—'}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 8 }}>
                                            💡 Save each time slot separately throughout the day. All readings are stored independently.
                                        </div>
                                    </div>
                                ) : null;
                            })()}

                            {/* HbA1c — single full-width row */}
                            <div className="rec-field-group" style={{ maxWidth: 340 }}>
                                <label className="rec-label">HbA1c (%)</label>
                                <input type="number" className="rec-input" placeholder="e.g., 5.5"
                                    value={form.hba1c} onChange={set('hba1c')} min="0" step="0.1" />
                                <div className="rec-hint">Normal: &lt;5.7% &nbsp;·&nbsp; Prediabetes: 5.7–6.4% &nbsp;·&nbsp; Diabetes: ≥6.5% (ADA 2024) &nbsp;·&nbsp; Malaysia MOH: ≥6.3% = Diabetes</div>
                            </div>

                            <div className="rec-tip">
                                💡 <strong>Tip:</strong> Regular blood sugar monitoring helps track your progress.
                                Consult your healthcare provider for personalized target ranges.
                            </div>
                        </div>


                        {/* ── Food Intake ──────────────────────────────── */}
                        <div className="rec-card">
                            <div className="rec-section-header">
                                <div className="rec-section-icon food">🥗</div>
                                <div>
                                    <div className="rec-section-title">Food Intake</div>
                                    <div className="rec-section-sub">Record your meals — search the food database for nutritional info</div>
                                </div>
                            </div>

                            {/* API Banner */}
                            <div className="food-api-banner">
                                <span className="food-api-icon">🌐</span>
                                <span>
                                    <strong>Food Database:</strong> Search any food below to auto-fill nutritional info
                                    (calories, carbs, sugar) powered by{' '}
                                    <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener noreferrer">
                                        Open Food Facts
                                    </a>.
                                </span>
                            </div>

                            <div className="rec-grid-1">
                                {mealFields.map(({ field, label, ph }) => (
                                    <div className="rec-field-group" key={field}>
                                        <label className="rec-label">{label}</label>

                                        {/* Food search widget */}
                                        <FoodSearchWidget
                                            mealKey={field}
                                            onSelect={(item) => handleFoodSelect(field, item)}
                                        />

                                        {/* Nutrition badge if a food was selected */}
                                        <NutritionBadge
                                            info={nutrition[field]}
                                            onClear={() => clearNutrition(field)}
                                        />

                                        {/* Manual text input */}
                                        <input
                                            type="text"
                                            className="rec-input"
                                            placeholder={ph}
                                            value={form[field]}
                                            onChange={set(field)}
                                            id={`meal-${field}`}
                                        />
                                        <div className="rec-hint">Type freely or pick from search results above</div>
                                    </div>
                                ))}

                                <div className="rec-field-group">
                                    <label className="rec-label">Water Intake (glasses)</label>
                                    <input type="number" className="rec-input" placeholder="e.g., 8"
                                        value={form.waterIntake} onChange={set('waterIntake')} min="0" max="30"
                                        style={{ maxWidth: 200 }} />
                                    <div className="rec-hint">Recommended: 8 glasses (2 liters) per day</div>
                                </div>
                            </div>
                        </div>

                        {/* ── Physical Activity ─────────────────────────── */}
                        <div className="rec-card">
                            <div className="rec-section-header">
                                <div className="rec-section-icon activity">⚡</div>
                                <div>
                                    <div className="rec-section-title">Physical Activity</div>
                                    <div className="rec-section-sub">Track your exercise and movement</div>
                                </div>
                            </div>

                            <div className="rec-grid-1">
                                <div className="rec-field-group">
                                    <label className="rec-label">🦶 Daily Steps</label>
                                    <input type="number" className="rec-input" placeholder="e.g., 8000"
                                        value={form.dailySteps} onChange={set('dailySteps')} min="0" />
                                    <div className="rec-hint">Total steps walked today (aim for 10,000 steps daily)</div>
                                </div>
                                <div className="rec-field-group">
                                    <label className="rec-label">Activity Duration (minutes)</label>
                                    <input type="number" className="rec-input" placeholder="e.g., 45"
                                        value={form.activityDuration} onChange={set('activityDuration')} min="0" />
                                    <div className="rec-hint">Total minutes of physical activity today (aim for 30+ minutes daily)</div>
                                </div>
                                <div className="rec-field-group">
                                    <label className="rec-label">Activity Type</label>
                                    <select
                                        className="rec-input rec-select"
                                        value={form.activityType}
                                        onChange={set('activityType')}
                                    >
                                        <option value="">Select activity type</option>
                                        {activityTypes.map((a) => <option key={a} value={a}>{a}</option>)}
                                    </select>
                                    <div className="rec-hint">Choose the main type of activity you did today</div>

                                    {/* Free-text field slides in when 'Other' is selected */}
                                    {form.activityType === 'Other' && (
                                        <div style={{ marginTop: 10 }}>
                                            <input
                                                type="text"
                                                className="rec-input"
                                                placeholder="e.g., Badminton, Hiking, Pilates, Rock climbing…"
                                                value={form.activityTypeOther}
                                                onChange={set('activityTypeOther')}
                                                maxLength={80}
                                                autoFocus
                                            />
                                            <div className="rec-hint">Please describe your activity</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ── Body Measurement ─────────────────────────── */}
                        <div className="rec-card">
                            <div className="rec-section-header">
                                <div className="rec-section-icon body">⚖️</div>
                                <div>
                                    <div className="rec-section-title">Body Measurement</div>
                                    <div className="rec-section-sub">Record your weight and health notes</div>
                                </div>
                            </div>

                            <div className="rec-grid-1">
                                <div className="rec-field-group">
                                    <label className="rec-label">Weight (kg)</label>
                                    <input type="number" className="rec-input" placeholder="e.g., 72.5"
                                        value={form.weight} onChange={set('weight')} min="0" step="0.1"
                                        style={{ maxWidth: 200 }} />
                                    <div className="rec-hint">Enter your current weight in kilograms</div>
                                </div>
                                <div className="rec-field-group">
                                    <label className="rec-label">Additional Notes</label>
                                    <textarea
                                        className="rec-input rec-textarea"
                                        placeholder="Any health observations, symptoms, or important notes..."
                                        value={form.notes}
                                        onChange={set('notes')}
                                        rows={4}
                                    />
                                    <div className="rec-hint">Optional: Record how you feel, energy levels, or any health concerns</div>
                                </div>
                            </div>
                        </div>

                        {/* ── Feedback ─────────────────────────────────── */}
                        {error && (
                            <div className="error-msg" style={{ display: 'block' }}>
                                {error.split('\n').map((msg, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < error.split('\n').length - 1 ? 6 : 0 }}>
                                        <span style={{ flexShrink: 0 }}>⚠️</span>
                                        <span>{msg}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {saved && (
                            <div className="success-msg">✅ Record saved successfully for {form.date}!</div>
                        )}

                        {/* ── Save Button ───────────────────────────────── */}
                        <button type="submit" className="btn-primary" disabled={saving}
                            style={{ maxWidth: 520, margin: '0 auto' }}>
                            {saving ? <span className="spinner" /> : 'Save today\'s record'}
                        </button>

                    </form>
                </div>
            </div>
        </div>
    );
}
