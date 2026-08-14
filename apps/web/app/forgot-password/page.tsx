"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { supabase } from "../../lib/supabase/client";
import { AuthShell, ErrorBanner, Spinner } from "../auth-ui";

type FormState = "idle" | "loading" | "success" | "error";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setFormState("loading");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) { setErrorMessage(error.message); setFormState("error"); return; }
      setFormState("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to send reset link.");
      setFormState("error");
    }
  };

  return (
    <AuthShell
      icon="lock_reset"
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to reset your password."
    >
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
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <span
                  className="material-symbols-outlined text-status-active text-[32px]"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  mark_email_read
                </span>
              </div>
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: "radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)",
                  transform: "scale(1.8)",
                }}
              />
            </div>

            <div>
              <h2 className="text-xl font-bold text-text-primary">Check your email</h2>
              <p className="text-sm text-text-secondary mt-2 leading-relaxed">
                We&apos;ve sent a reset link to{" "}
                <span className="font-semibold text-text-primary">{email}</span>. Check your inbox and spam folder.
              </p>
            </div>

            <Link href="/login" className="btn-ghost w-full">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Login
            </Link>

            <p className="text-xs text-text-secondary">
              Didn&apos;t receive it?{" "}
              <button
                onClick={() => setFormState("idle")}
                className="font-semibold text-text-primary hover:underline"
              >
                Click to resend
              </button>
            </p>
          </motion.div>
        ) : (
          <motion.div key="form">
            <AnimatePresence>
              {formState === "error" && <ErrorBanner key="err">{errorMessage}</ErrorBanner>}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="form-label" htmlFor="email-reset">Email address</label>
                <input
                  id="email-reset"
                  type="email"
                  className="form-input"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <button
                type="submit"
                disabled={formState === "loading"}
                className="btn-primary w-full h-[42px]"
              >
                {formState === "loading" ? (<><Spinner /> Sending…</>) : "Send reset link"}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-border-subtle text-center">
              <Link
                href="/login"
                className="text-sm text-text-secondary hover:text-text-primary transition-colors flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                Back to Login
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthShell>
  );
}
