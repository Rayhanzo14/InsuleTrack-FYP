/**
 * TopHeader — shared page header used by every authenticated page.
 *
 * Reads the live streak from Firestore and shows it in the badge.
 * Also shows the user's display name, email and avatar initials.
 *
 * Props:
 *   user   – Firebase Auth user object (required)
 *   profile – Firestore profile data (optional, for fullName)
 */
import React from 'react';
import { useStreak } from '../hooks/useStreak';

export default function TopHeader({ user, profile }) {
    const { current: currentStreak } = useStreak(user?.uid);

    const displayName =
        profile?.fullName || user?.displayName || user?.email?.split('@')[0] || 'User';

    const initials = displayName
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    return (
        <header className="db-header">
            <div className="db-header-left">
                <div className="streak-badge">
                    🔥 Streak:{' '}
                    <strong>
                        {currentStreak} {currentStreak === 1 ? 'day' : 'days'}
                    </strong>
                </div>
            </div>
            <div className="db-header-right">
                <div className="user-info">
                    <div className="user-name">{displayName}</div>
                    <div className="user-email">{user?.email}</div>
                </div>
                <div className="user-avatar">{initials}</div>
            </div>
        </header>
    );
}
