import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import Register from './pages/SignUp';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import RecordData from './pages/RecordData';
import Progress from './pages/Progress';
import Achievements from './pages/Achievements';
import Recommendations from './pages/Recommendations';
import Report from './pages/Report';
import Profile from './pages/Profile';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsers from './pages/AdminUsers';
import AdminStats from './pages/AdminStats';
import AdminAchievements from './pages/AdminAchievements';
import AdminRules from './pages/AdminRules';
import AdminLogs from './pages/AdminLogs';

/* ── Auth state hook ─────────────────────────────────────────── */
function useAuthState() {
  const [authState, setAuthState] = useState({ user: null, role: null, loading: true });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setAuthState({ user: null, role: null, loading: false });
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', u.uid));
        const role = snap.exists() ? (snap.data().role || 'user') : 'user';
        setAuthState({ user: u, role, loading: false });
      } catch {
        // Firestore read failed — default to regular user
        setAuthState({ user: u, role: 'user', loading: false });
      }
    });
    return () => unsub();
  }, []);

  return authState;
}

/* ── Route guards ────────────────────────────────────────────── */
function ProtectedRoute({ children, authState }) {
  if (authState.loading) return null; // wait for auth check — no flash
  if (!authState.user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children, authState }) {
  if (authState.loading) return null;
  if (!authState.user) return <Navigate to="/login" replace />;
  if (authState.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

/* ── App ────────────────────────────────────────────────────── */
export default function App() {
  const authState = useAuthState();

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* Protected user routes */}
        <Route path="/dashboard"       element={<ProtectedRoute authState={authState}><Dashboard /></ProtectedRoute>} />
        <Route path="/record"          element={<ProtectedRoute authState={authState}><RecordData /></ProtectedRoute>} />
        <Route path="/progress"        element={<ProtectedRoute authState={authState}><Progress /></ProtectedRoute>} />
        <Route path="/achievements"    element={<ProtectedRoute authState={authState}><Achievements /></ProtectedRoute>} />
        <Route path="/recommendations" element={<ProtectedRoute authState={authState}><Recommendations /></ProtectedRoute>} />
        <Route path="/report"          element={<ProtectedRoute authState={authState}><Report /></ProtectedRoute>} />
        <Route path="/profile"         element={<ProtectedRoute authState={authState}><Profile /></ProtectedRoute>} />

        {/* Protected admin routes */}
        <Route path="/admin"                element={<AdminRoute authState={authState}><AdminDashboard /></AdminRoute>} />
        <Route path="/admin/users"          element={<AdminRoute authState={authState}><AdminUsers /></AdminRoute>} />
        <Route path="/admin/stats"          element={<AdminRoute authState={authState}><AdminStats /></AdminRoute>} />
        <Route path="/admin/achievements"   element={<AdminRoute authState={authState}><AdminAchievements /></AdminRoute>} />
        <Route path="/admin/rules"          element={<AdminRoute authState={authState}><AdminRules /></AdminRoute>} />
        <Route path="/admin/logs"           element={<AdminRoute authState={authState}><AdminLogs /></AdminRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
