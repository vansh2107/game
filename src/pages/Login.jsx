import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      setError('');
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
      // Requirement: After login redirect to /mode-select
      navigate('/mode-select');
    } catch (err) {
      setError('Failed to log in. Please check your credentials.');
    }
    setLoading(false);
  }

  return (
    <div className="container center">
      <div className="card">
        <h2 className="title">Login</h2>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit} className="form-group">
          <input 
            type="email" 
            placeholder="Email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)} 
            required 
          />
          <input 
            type="password" 
            placeholder="Password" 
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)} 
            required 
          />
          <button disabled={loading} type="submit" className="button primary">Log In</button>
        </form>
        <div className="links">
          <Link to="/forgot-password">Forgot Password?</Link>
        </div>
        <div className="links">
          Need an account? <Link to="/signup">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
