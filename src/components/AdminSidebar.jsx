/**
 * AdminSidebar.jsx – Admin-only sidebar navigation
 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { MdDashboard, MdPeople, MdBarChart, MdTune, MdHistory, MdEmojiEvents } from 'react-icons/md';
import logo from '../assets/logo.png';

const adminNav = [
    { to: '/admin', icon: <MdDashboard />, label: 'Dashboard' },
    { to: '/admin/users', icon: <MdPeople />, label: 'Users' },
    { to: '/admin/stats', icon: <MdBarChart />, label: 'Usage statistics' },
    { to: '/admin/achievements', icon: <MdEmojiEvents />, label: 'Achievements' },
    { to: '/admin/rules', icon: <MdTune />, label: 'Rules and settings' },
    { to: '/admin/logs', icon: <MdHistory />, label: 'System logs' },
];

export default function AdminSidebar({ onLogout }) {
    return (
        <aside className="admin-sidebar">
            {/* Brand */}
            <div className="admin-sidebar-brand">
                <div className="admin-sidebar-logo"><img src={logo} alt="InsuleTrack logo" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }} /></div>
                <div>
                    <div className="admin-sidebar-name">InsuleTrack</div>
                    <div className="admin-sidebar-role">Administrator Console</div>
                </div>
            </div>

            {/* Nav */}
            <nav className="admin-sidebar-nav">
                {adminNav.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/admin'}
                        className={({ isActive }) =>
                            `admin-sidebar-link${isActive ? ' active' : ''}`
                        }
                    >
                        <span className="admin-sidebar-icon">{item.icon}</span>
                        <span>{item.label}</span>
                    </NavLink>
                ))}
            </nav>

            {/* Log Out */}
            <div className="admin-sidebar-footer">
                <button className="admin-sidebar-logout" onClick={onLogout}>
                    🚪 Log Out
                </button>
            </div>
        </aside>
    );
}
