import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== passwordConfirm) {
      return setError('Passwords do not match');
    }

    try {
      setError('');
      setLoading(true);
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
      
      // Store user details in Firestore
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        email: user.email,
        createdAt: new Date().toISOString()
      });

      // Requirement: After login/signup redirect to /mode-select or /home
      navigate('/mode-select');
    } catch (err) {
      console.error(err);
      setError(`Failed to create an account: ${err.message}`);
    }
    setLoading(false);
  }

  return (
    <div className="container center">
      <div className="card">
        <h2 className="title">Sign Up</h2>
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
          <input 
            type="password" 
            placeholder="Confirm Password" 
            className="input"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)} 
            required 
          />
          <button disabled={loading} type="submit" className="button primary">Sign Up</button>
        </form>
        <div className="links">
          Already have an account? <Link to="/login">Log In</Link>
        </div>
      </div>
    </div>
  );
}
