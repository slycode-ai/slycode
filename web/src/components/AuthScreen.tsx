'use client';

/**
 * Login / first-run password screen (Feature 068).
 * One component, two modes. On success it hard-navigates to the dashboard so
 * the new cookie is picked up by the middleware on the next request.
 */

import { useState } from 'react';

type Mode = 'login' | 'setup';

const MIN_LENGTH = 6;

export default function AuthScreen({ mode }: { mode: Mode }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSetup = mode === 'setup';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Length is only validated when CHOOSING a password (setup). On login we
    // send whatever the user types — the password either matches the stored
    // hash or it doesn't; never gate login on length.
    if (isSetup) {
      if (password.length < MIN_LENGTH) {
        setError(`Password must be at least ${MIN_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    } else if (password.length === 0) {
      setError('Enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/${isSetup ? 'setup' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.replace('/');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; retryAfterSec?: number };
      if (res.status === 429) {
        setError(data.message || `Too many attempts. Try again in ${data.retryAfterSec ?? 60}s.`);
      } else if (res.status === 401) {
        setError('Incorrect password.');
      } else {
        setError(data.message || data.error || 'Something went wrong.');
      }
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dark min-h-svh w-full flex items-center justify-center bg-void-950 text-void-100 px-4 relative overflow-hidden">
      {/* ambient neon glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(0,191,255,0.10), transparent 70%), radial-gradient(40% 40% at 80% 100%, rgba(0,191,255,0.06), transparent 70%)',
        }}
      />
      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-void-700 bg-void-900/80 backdrop-blur p-8 shadow-[0_24px_64px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,191,255,0.08)]"
      >
        <div className="flex flex-col items-center text-center mb-7">
          <span
            className="text-neon-blue-400 text-[15px] tracking-tight mb-3"
            style={{ fontFamily: 'var(--font-press-start-2p)', textShadow: '0 0 12px rgba(0,191,255,0.45)' }}
          >
            SlyCode
          </span>
          <h1 className="text-lg font-semibold text-void-100">
            {isSetup ? 'Create a password' : 'Sign in'}
          </h1>
          <p className="mt-1.5 text-sm text-void-400">
            {isSetup
              ? 'Set a password to protect this dashboard. You can reset it from the server with “slycode reset-password”.'
              : 'Enter your password to access the dashboard.'}
          </p>
        </div>

        <label className="block text-xs font-medium text-void-400 mb-1.5" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-void-700 bg-void-950 px-3.5 py-2.5 text-void-100 placeholder-void-500 outline-none focus:border-neon-blue-400 focus:ring-1 focus:ring-neon-blue-400/40 transition"
          placeholder="••••••••"
        />

        {isSetup && (
          <>
            <label className="block text-xs font-medium text-void-400 mt-4 mb-1.5" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-void-700 bg-void-950 px-3.5 py-2.5 text-void-100 placeholder-void-500 outline-none focus:border-neon-blue-400 focus:ring-1 focus:ring-neon-blue-400/40 transition"
              placeholder="••••••••"
            />
          </>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-lg bg-neon-blue-400 px-4 py-2.5 font-semibold text-void-950 hover:bg-neon-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-[0_0_20px_rgba(0,191,255,0.25)]"
        >
          {submitting ? 'Please wait…' : isSetup ? 'Create password' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
