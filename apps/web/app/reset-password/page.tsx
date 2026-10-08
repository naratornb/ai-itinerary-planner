"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { supabase } from "../../lib/supabase/client";
import { AuthShell, ErrorBanner, Spinner } from "../auth-ui";

type FormState = "idle" | "loading" | "success" | "error";
// The recovery link lands here with tokens in the URL hash; the client parses
// them during init, so INITIAL_SESSION/PASSWORD_RECOVERY carries the verdict.
type LinkState = "pending" | "ready" | "missing";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [linkState, setLinkState] = useState<LinkState>("pending");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) setLinkState("ready");
      else if (event === "INITIAL_SESSION") setLinkState("missing");
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setFieldError("");

    if (password.length < 8) {
      setFieldError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }

    setFormState("loading");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setErrorMessage(error.message); setFormState("error"); return; }
      setFormState("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update password.");
      setFormState("error");
    }
  };

  return (
    <AuthShell
      icon="lock_reset"
      title="Choose a new password"
      subtitle="Enter a new password for your account."
    >
      {linkState === "pending" ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : linkState === "missing" ? (
        <div className="flex flex-col items-center text-center gap-5">
          <ErrorBanner>This reset link is invalid or has expired.</ErrorBanner>
          <Link href="/forgot-password" className="btn-primary w-full">
            Request a new link
          </Link>
          <Link
            href="/login"
            className="text-sm text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Login
          </Link>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {formState === "success" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center text-center gap-5"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <span
                  className="material-symbols-outlined text-status-active text-[32px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-text-primary">Password updated</h2>
                <p className="text-sm text-text-secondary mt-2 leading-relaxed">
                  Your password has been changed. You can sign in with it now.
                </p>
              </div>
              <Link href="/login" className="btn-primary w-full">
                Sign in
              </Link>
            </motion.div>
          ) : (
            <motion.div key="form">
              <AnimatePresence>
                {(formState === "error" || fieldError) && (
                  <ErrorBanner key="err">{fieldError || errorMessage}</ErrorBanner>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div>
                  <label className="form-label" htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    className="form-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={8}
                  />
                </div>

                <div>
                  <label className="form-label" htmlFor="confirm-new-password">Confirm password</label>
                  <input
                    id="confirm-new-password"
                    type="password"
                    className={`form-input ${fieldError ? "error" : ""}`}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  {fieldError && (
                    <p className="mt-1.5 text-xs text-status-error flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">warning</span>
                      {fieldError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={formState === "loading"}
                  className="btn-primary w-full h-[42px] mt-1"
                >
                  {formState === "loading" ? (<><Spinner /> Updating…</>) : "Update password"}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </AuthShell>
  );
}
