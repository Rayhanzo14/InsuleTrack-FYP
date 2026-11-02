/**
 * logEvent.js
 * Writes a real event document to the `systemLogs` Firestore collection.
 * Call this at every meaningful user/admin action so AdminLogs.jsx can
 * display genuine data instead of derived/hardcoded entries.
 *
 * Usage:
 *   import { logEvent } from '../utils/logEvent';
 *   await logEvent(db, { level, category, user, message });
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * @param {import('firebase/firestore').Firestore} db
 * @param {{ level: 'INFO'|'SUCCESS'|'WARNING'|'ERROR', category: string, user: string, message: string }} entry
 */
export async function logEvent(db, { level, category, user, message }) {
    try {
        await addDoc(collection(db, 'systemLogs'), {
            level,
            category,
            user,
            message,
            createdAt: serverTimestamp(),
        });
    } catch (err) {
        // Logging is non-critical — never let it break the caller
        console.warn('[logEvent] Failed to write system log:', err.message);
    }
}
