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
    <div className="relative flex min-h-svh w-full items-center justify-center overflow-hidden bg-page px-4 text-ink-1">
      {/* ambient neon glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%)',
        }}
      />
      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-8 shadow-(--shadow-overlay)"
      >
        <div className="mb-7 flex flex-col items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/slycode_logo_light.webp" alt="SlyCode" className="mb-4 h-11 w-11 object-contain mix-blend-multiply dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/slycode_logo.webp" alt="SlyCode" className="mb-4 hidden h-11 w-11 object-contain mix-blend-lighten dark:block" />
          <h1 className="text-xl font-semibold tracking-tight text-ink-1">
            {isSetup ? 'Create a password' : 'Sign in to SlyCode'}
          </h1>
          <p className="mt-1.5 text-sm text-ink-2">
            {isSetup
              ? 'Set a password to protect this dashboard. You can reset it from the server with “slycode reset-password”.'
              : 'Enter your password to access the dashboard.'}
          </p>
        </div>

        <label className="mb-1.5 block text-[13px] font-medium text-ink-2" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete={isSetup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface-2 px-3.5 py-2.5 text-ink-1 placeholder:text-ink-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25"
          placeholder="••••••••"
        />

        {isSetup && (
          <>
            <label className="mb-1.5 mt-4 block text-[13px] font-medium text-ink-2" htmlFor="confirm">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-line-strong bg-surface-2 px-3.5 py-2.5 text-ink-1 placeholder:text-ink-3 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25"
              placeholder="••••••••"
            />
          </>
        )}

        {error && (
          <p className="mt-4 text-sm text-danger-text" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-on-primary transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Please wait…' : isSetup ? 'Create password' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
