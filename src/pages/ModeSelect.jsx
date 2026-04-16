import React from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export default function ModeSelect() {
  const navigate = useNavigate();

  async function handleLogout() {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
    }
  }

  return (
    <div className="container center">
      <div className="card text-center">
        <h1 className="title">Mode Selection</h1>
        <div className="form-group">
          <button onClick={() => navigate('/single-player')} className="button primary">
            Single Player
          </button>
          <button onClick={() => navigate('/multiplayer')} className="button primary">
            Multiplayer
          </button>
        </div>
        <div className="links" style={{ marginTop: '20px' }}>
          <button onClick={handleLogout} className="button secondary">Log Out</button>
        </div>
      </div>
    </div>
  );
}
