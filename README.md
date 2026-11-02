# InsuleTrack — Diabetes Prevention & Monitoring System

> **Final Year Project (FYP)**  
> Aligned with **United Nations Sustainable Development Goal 3: Good Health & Well-Being**

InsuleTrack is a modern web application designed to support individuals in managing and preventing type 2 diabetes through daily lifestyle logging, intelligent risk assessment, habit gamification, and actionable health reports.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18 or higher recommended)
- Firebase Project with **Authentication** and **Cloud Firestore** enabled

### 2. Environment Setup
Create a `.env` file in the root folder with your Firebase project credentials:

```env
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

### 3. Installation & Run

```bash
# Install dependencies
npm install

# Start local development server (http://localhost:5173)
npm run dev

# Run linting
npx eslint src

# Build for production
npm run build
```

---

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite 7
- **Routing**: React Router 7 (with Route Guards)
- **Backend & Database**: Firebase Authentication, Cloud Firestore, Firebase Analytics
- **Visualisations**: Recharts
- **PDF Generation**: jsPDF, html2canvas
- **Icons**: React Icons (Material Design)

---

## 🔒 Role-Based Access Control (RBAC)

The application separates user and administrator capabilities:
- **`user` (Patient)**: Has access to daily logging, progress trends, dynamic tips, achievements, and downloadable personal health reports.
- **`admin` (System Administrator)**: Accesses the Administrator Console (`/admin`) to view system logs, configure clinical risk thresholds, monitor platform KPIs, and manage registered users.

> **Note**: To grant admin access to an account, set `role: "admin"` on the user's document in the `users` Firestore collection via the Firebase Console.

---

## 📖 Detailed Developer Documentation

For the full technical breakdown—including Firestore collections, the diabetes risk score formula, streak algorithms, and architecture diagrams—refer to the technical documentation:

- **[Developer Guide](developer-guide.md)**
- **[Firestore Security Rules](firestore.rules)**
