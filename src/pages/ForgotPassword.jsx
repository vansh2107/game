import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      setMessage('');
      setError('');
      setLoading(true);
      await sendPasswordResetEmail(auth, email);
      setMessage('Check your inbox for further instructions.');
    } catch (err) {
      setError('Failed to reset password. Check the email provided.');
    }
    setLoading(false);
  }

  return (
    <div className="container center">
      <div className="card">
        <h2 className="title">Password Reset</h2>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <form onSubmit={handleSubmit} className="form-group">
          <input 
            type="email" 
            placeholder="Email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)} 
            required 
          />
          <button disabled={loading} type="submit" className="button primary">Reset Password</button>
        </form>
        <div className="links">
          <Link to="/login">Back to Login</Link>
        </div>
        <div className="links">
          Need an account? <Link to="/signup">Sign Up</Link>
        </div>
      </div>
    </div>
  );
}
