import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ModeSelect from './pages/ModeSelect';
import SinglePlayer from './pages/SinglePlayer';
import Multiplayer from './pages/Multiplayer';
import Home from './pages/Home';
import './index.css';

function AppRoutes() {
  const { currentUser } = useAuth();
  
  return (
    <Routes>
      {/* Auth routes */}
      <Route path="/login" element={currentUser ? <Navigate to="/mode-select" replace /> : <Login />} />
      <Route path="/signup" element={currentUser ? <Navigate to="/mode-select" replace /> : <Signup />} />
      <Route path="/forgot-password" element={currentUser ? <Navigate to="/mode-select" replace /> : <ForgotPassword />} />
      
      {/* Base redirection */}
      <Route path="/" element={<Navigate to={currentUser ? "/mode-select" : "/login"} replace />} />

      {/* Protected endpoints */}
      <Route path="/mode-select" element={<ProtectedRoute><ModeSelect /></ProtectedRoute>} />
      <Route path="/single-player" element={<ProtectedRoute><SinglePlayer /></ProtectedRoute>} />
      <Route path="/multiplayer" element={<ProtectedRoute><Multiplayer /></ProtectedRoute>} />
      <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
