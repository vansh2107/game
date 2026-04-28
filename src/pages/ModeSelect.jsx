import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export default function ModeSelect() {
  const navigate = useNavigate();

  async function handleLogout() {
    try { await signOut(auth); navigate('/login'); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="container center">
      <div className="card text-center">
        <div style={{ fontSize: '52px', marginBottom: '12px' }}>🏏</div>
        <h1 className="title">Cricket Live</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '28px', fontSize: '14px' }}>
          Choose your game mode
        </p>
        <div className="form-group">
          <button onClick={() => navigate('/multiplayer')} className="button primary">
            🌐 Multiplayer
          </button>
          <button disabled className="button secondary" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
            🤖 Single Player — Coming Soon
          </button>
        </div>
        <hr className="crease" style={{ marginTop: '24px' }} />
        <button onClick={handleLogout} className="button secondary" style={{ marginTop: '4px' }}>
          Log Out
        </button>
      </div>
    </div>
  );
}
