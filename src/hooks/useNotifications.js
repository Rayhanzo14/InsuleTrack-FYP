/**
 * useNotifications.js
 * Manages Web Notifications + Vibration API + Audio chime for InsuleTrack reminders.
 *
 * Scheduler design (v2 — precision-based):
 *  - Uses setTimeout to fire at the EXACT target time (millisecond precision).
 *  - Automatically reschedules for the same time the next day after firing.
 *  - Restarts immediately whenever timePreference or customTime changes.
 *  - Fired-today state persisted in localStorage (survives page refresh).
 *  - Falls back from ServiceWorker → new Notification() on desktop.
 *  - Plays a gentle 3-note chime via Web Audio API on every notification.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

/* ── Reminder definitions ─────────────────────────────── */
const REMINDER_DEFS = {
    dailyRecord: {
        title: '⏰ Time to log your health data!',
        body: 'Keep your streak alive — record your blood sugar, meals, and activity for today.',
        vibrate: [200, 100, 200],
    },
    weeklyProgress: {
        title: '📊 Weekly progress review',
        body: "Your weekly health summary is ready. Check how far you've come this week!",
        vibrate: [300, 100, 300],
    },
    medication: {
        title: '💊 Medication reminder',
        body: "Don't forget to take your medications as prescribed.",
        vibrate: [100, 50, 100, 50, 100],
    },
    activity: {
        title: '🏃 Time to get active!',
        body: "You've set an activity reminder — stay on track with your fitness goals today.",
        vibrate: [200, 100, 200, 100, 200],
    },
};

/* ── Fixed time map (morning / evening) ────────────────── */
const FIXED_TIME_MAP = {
    morning: [8, 0],
    evening: [19, 0],
};

/* ── Web Audio chime ──────────────────────────────────── */
/**
 * Plays a pleasant three-note ascending chime using the Web Audio API.
 * Works on any modern browser without needing audio files.
 * Silently skips if AudioContext is unavailable.
 */
function playChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        const ctx = new AudioCtx();

        // Three notes: C5 → E5 → G5 (a C-major arpeggio, cheerful & calm)
        const notes = [523.25, 659.25, 783.99];
        const startTime = ctx.currentTime;

        notes.forEach((freq, i) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime + i * 0.18);

            // Envelope: quick attack, gentle decay, sustain, release
            const t0 = startTime + i * 0.18;
            gain.gain.setValueAtTime(0,    t0);
            gain.gain.linearRampToValueAtTime(0.35, t0 + 0.04);  // attack
            gain.gain.linearRampToValueAtTime(0.22, t0 + 0.12);  // decay
            gain.gain.linearRampToValueAtTime(0.18, t0 + 0.28);  // sustain
            gain.gain.linearRampToValueAtTime(0,    t0 + 0.55);  // release

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + 0.6);
        });

        // Close context after all notes finish
        setTimeout(() => { ctx.close().catch(() => {}); }, 1200);
    } catch {
        // Silently ignore — audio is a nice-to-have
    }
}

/* ── Helpers ──────────────────────────────────────────── */
function getPermission() {
    return 'Notification' in window ? Notification.permission : 'unsupported';
}

async function doRequestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return Notification.requestPermission();
}

function vibrate(pattern) {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
}

/**
 * Show a notification — prefers ServiceWorker for reliability.
 * Falls back to new Notification() for desktop without SW.
 */
async function showNotification(title, options) {
    const swReady =
        'serviceWorker' in navigator &&
        navigator.serviceWorker.controller !== null;

    if (swReady) {
        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.showNotification(title, {
                ...options,
                icon: '/favicon.ico',
                badge: '/favicon.ico',
            });
            return;
        } catch { /* fall through */ }
    }

    try {
        const n = new Notification(title, {
            ...options,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
        });
        setTimeout(() => n.close(), 8000);
    } catch { /* silently ignore */ }
}

async function fireNotification(key, reminders) {
    const def = REMINDER_DEFS[key];
    if (!def || !reminders[key]) return;
    if (Notification.permission !== 'granted') return;

    // One notification per key per calendar day
    const todayKey = new Date().toISOString().slice(0, 10);
    const lsKey    = `insuletrack-notif-${key}-${todayKey}`;
    if (localStorage.getItem(lsKey)) return;
    localStorage.setItem(lsKey, '1');

    // Chime plays first for immediate audio feedback
    playChime();

    await showNotification(def.title, {
        body: def.body,
        tag: `insuletrack-${key}`,
        renotify: true,
        requireInteraction: false,
        vibrate: def.vibrate,
    });

    vibrate(def.vibrate);
}

/**
 * Resolve [hour, minute] from the current preference.
 * For 'custom', parse the HH:MM string supplied by the user.
 */
function resolveTargetTime(timePreference, customTime) {
    if (timePreference === 'custom') {
        if (customTime && /^\d{2}:\d{2}$/.test(customTime)) {
            const [h, m] = customTime.split(':').map(Number);
            if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return [h, m];
        }
        return [9, 0]; // safe fallback
    }
    return FIXED_TIME_MAP[timePreference] ?? FIXED_TIME_MAP.morning;
}

/**
 * Calculate exact milliseconds from now until the next occurrence of [targetH, targetM].
 * If that time has already passed today, schedules for tomorrow.
 */
function msUntilTarget(targetH, targetM) {
    const now    = new Date();
    const target = new Date(now);
    target.setHours(targetH, targetM, 0, 0);  // set to today at target time

    // If we're already past (or at) the target for today → schedule tomorrow
    if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
    }

    return target.getTime() - now.getTime();
}

/* ── Hook ─────────────────────────────────────────────── */
/**
 * @param {object}  reminders       - { dailyRecord, weeklyProgress, medication, activity }
 * @param {string}  timePreference  - 'morning' | 'evening' | 'custom'
 * @param {boolean} enabled         - master switch
 * @param {string}  customTime      - HH:MM string (only used when timePreference === 'custom')
 */
export default function useNotifications(
    reminders,
    timePreference,
    enabled = true,
    customTime = '09:00',
) {
    // Track permission reactively so the scheduler restarts after grant
    const [permissionState, setPermissionState] = useState(getPermission);

    // Always-fresh ref for reminders (avoids stale closure inside setTimeout)
    const remindersRef = useRef(reminders);
    useEffect(() => { remindersRef.current = reminders; }, [reminders]);

    // ── Precision scheduler ──────────────────────────────────────────────────
    // Restarts whenever any scheduling param changes: enabled, permission,
    // timePreference, or customTime.
    useEffect(() => {
        if (!enabled || permissionState !== 'granted') return;

        const [targetH, targetM] = resolveTargetTime(timePreference, customTime);
        let timeoutId;

        function fireAndReschedule() {
            // Fire all enabled reminders
            Object.keys(REMINDER_DEFS).forEach(key =>
                fireNotification(key, remindersRef.current)
            );
            // Schedule the next occurrence (same time tomorrow)
            timeoutId = setTimeout(fireAndReschedule, msUntilTarget(targetH, targetM));
        }

        // Set the ONE-SHOT timeout for the next exact target time
        const ms = msUntilTarget(targetH, targetM);
        timeoutId = setTimeout(fireAndReschedule, ms);

        return () => clearTimeout(timeoutId);

        // Re-runs whenever any of these change → old timeout is cancelled,
        // new one is set for the updated time.
    }, [enabled, permissionState, timePreference, customTime]);

    // ── Exposed API ─────────────────────────────────────────────────────────
    const requestPermission = useCallback(async () => {
        const result = await doRequestPermission();
        setPermissionState(result); // triggers scheduler useEffect if granted
        return result;
    }, []);

    const sendTestNotification = useCallback(async () => {
        if (Notification.permission !== 'granted') {
            console.warn('Notification permission not granted');
            throw new Error('Permission not granted');
        }

        playChime();

        await showNotification('✅ InsuleTrack — Notifications Working!', {
            body: 'Your reminders are set up correctly. You will be notified at the scheduled time.',
            tag: 'insuletrack-test',
            requireInteraction: true,
        });

        vibrate([100, 50, 100]);
    }, []);

    return {
        permission: permissionState,
        requestPermission,
        sendTestNotification,
    };
}
