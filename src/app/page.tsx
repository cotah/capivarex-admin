'use client';

import { useState, useEffect } from 'react';
import AdminDashboard from '@/components/AdminDashboard';

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? 'capivarex-admin';

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('capivarex_admin_authed') === '1') {
      setAuthed(true);
    }
  }, []);

  const handleLogin = () => {
    if (input === ADMIN_PASSWORD) {
      sessionStorage.setItem('capivarex_admin_authed', '1');
      localStorage.setItem('capivarex_admin_token', input);
      setAuthed(true);
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-80 space-y-4">
          <h1 className="text-white text-xl font-bold text-center">CAPIVAREX Admin</h1>
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="Password"
            className={`w-full px-4 py-3 rounded-xl bg-white/5 border text-white placeholder:text-white/30 outline-none ${
              error ? 'border-red-500' : 'border-white/10 focus:border-white/30'
            }`}
          />
          <button
            onClick={handleLogin}
            className="w-full py-3 rounded-xl bg-white/10 text-white hover:bg-white/15 transition-colors"
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  return <AdminDashboard />;
}
