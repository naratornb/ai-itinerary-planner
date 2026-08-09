"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence } from "framer-motion";

import { supabase } from "../../lib/supabase/client";
import { AuthShell, ErrorBanner, Spinner } from "../auth-ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setErrorMessage(error.message); return; }
      router.replace("/users");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to sign in. Check your Supabase configuration."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      icon="admin_panel_settings"
      title="Welcome back"
      subtitle={<>Sign in to continue to <span className="font-semibold text-text-primary">Supabase Admin</span>.</>}
    >
      <AnimatePresence>
        {errorMessage && (
          <ErrorBanner key="error" title="Authentication failed">{errorMessage}</ErrorBanner>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <label className="form-label" htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            className={`form-input ${errorMessage ? "error" : ""}`}
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-[6px]">
            <label className="form-label mb-0" htmlFor="password">Password</label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              className={`form-input pr-10 ${errorMessage ? "error" : ""}`}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-text-primary transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <span className="material-symbols-outlined text-[18px]">
                {showPassword ? "visibility_off" : "visibility"}
              </span>
            </button>
          </div>
        </div>

        <button type="submit" disabled={isSubmitting} className="btn-primary w-full h-[42px] mt-1">
          {isSubmitting ? (<><Spinner /> Signing in…</>) : "Log in"}
        </button>
      </form>

      <div className="mt-6 pt-6 border-t border-border-subtle text-center">
        <p className="text-sm text-text-secondary">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-semibold text-text-primary hover:underline underline-offset-2 transition-colors"
          >
            Register here
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
