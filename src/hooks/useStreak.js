/**
 * useStreak — reads check-in data from Firestore and returns streak stats.
 *
 * Firestore structure:
 *   users/{uid}/checkins/{YYYY-MM-DD}  →  { checkedIn: true, date: '...' }
 */
import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/** Returns today as YYYY-MM-DD in local timezone */
export function todayStr() {
    const d = new Date();
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}

/** Offset a date string by N days */
function offsetDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
    ].join('-');
}

/**
 * Given a Set of date strings, calculate streak stats.
 */
function calcStats(dateSet) {
    const total = dateSet.size;
    if (total === 0) return { current: 0, best: 0, total: 0 };

    const today = todayStr();
    const yesterday = offsetDate(today, -1);

    // ── Current streak ────────────────────────────────────────────
    let current = 0;
    // Streak starts from today if checked in, else from yesterday (grace)
    let cursor = dateSet.has(today) ? today : dateSet.has(yesterday) ? yesterday : null;

    if (cursor) {
        while (dateSet.has(cursor)) {
            current++;
            cursor = offsetDate(cursor, -1);
        }
    }

    // ── Best streak ───────────────────────────────────────────────
    const sorted = [...dateSet].sort(); // oldest → newest
    let best = 0;
    let run = 1;

    for (let i = 1; i < sorted.length; i++) {
        const diff =
            (new Date(sorted[i] + 'T00:00:00') - new Date(sorted[i - 1] + 'T00:00:00')) /
            86400000;
        if (diff === 1) {
            run++;
        } else {
            best = Math.max(best, run);
            run = 1;
        }
    }
    best = Math.max(best, run);
    best = Math.max(best, current);

    return { current, best, total };
}

/**
 * Custom hook.
 *
 * Returns:
 *   { current, best, total, checkedInToday, loading, checkIn }
 */
export function useStreak(uid) {
    const [dates, setDates] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [checkingIn, setCheckingIn] = useState(false);
    const [checkInError, setCheckInError] = useState('');

    // Fetch all check-in dates for this user
    const fetchDates = useCallback(async () => {
        if (!uid) return;
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'users', uid, 'checkins'));
            const ds = new Set();
            snap.forEach((d) => ds.add(d.id)); // document ID is the date string
            setDates(ds);
        } catch (e) {
            console.error('Failed to load check-ins:', e.message);
            // Firestore rules may be blocking — dates stays empty
        } finally {
            setLoading(false);
        }
    }, [uid]);

    useEffect(() => {
        fetchDates();
    }, [fetchDates]);

    // Save today's check-in to Firestore
    const checkIn = useCallback(async () => {
        if (!uid) return;
        const today = todayStr();
        if (dates.has(today)) return; // Already checked in
        setCheckingIn(true);
        setCheckInError('');
        try {
            await setDoc(doc(db, 'users', uid, 'checkins', today), {
                checkedIn: true,
                date: today,
                timestamp: serverTimestamp(),
            });
            setDates((prev) => new Set([...prev, today]));
        } catch (e) {
            console.error('Check-in failed:', e.message);
            if (e.code === 'permission-denied') {
                setCheckInError('Check-in failed: Firestore permissions not configured. See Firebase Console → Firestore → Rules.');
            } else {
                setCheckInError('Check-in failed. Please try again.');
            }
        } finally {
            setCheckingIn(false);
        }
    }, [uid, dates]);

    const stats = calcStats(dates);

    return {
        ...stats,
        checkedInToday: dates.has(todayStr()),
        loading,
        checkingIn,
        checkInError,
        checkIn,
        dates,
    };
}
