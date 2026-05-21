"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { supabase } from "../../lib/supabase/client";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

type FormState = "idle" | "loading" | "success" | "error";

export default function ForgotPasswordPage() {
  const [email, setEmail]             = useState("");
  const [formState, setFormState]     = useState<FormState>("idle");
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
    <div className="auth-bg min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 w-[400px] h-[400px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(100,116,139,0.1) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 w-[450px] h-[450px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)" }}
      />

      <motion.main
        variants={container}
        initial="hidden"
        animate="show"
        className="relative w-full max-w-[420px]"
      >
        {/* Brand */}
        <motion.div variants={item} className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
              boxShadow: "0 8px 24px rgba(15,23,42,0.28)",
            }}
          >
            <span
              className="material-symbols-outlined text-white text-[22px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              lock_reset
            </span>
          </div>
          <h1
            className="text-[28px] font-extrabold tracking-tight text-text-primary"
            style={{ fontFamily: "var(--font-plus-jakarta, inherit)", letterSpacing: "-0.03em" }}
          >
            Reset your password
          </h1>
          <p className="text-sm text-text-secondary mt-1.5 text-center max-w-xs">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </motion.div>

        <motion.div variants={item} className="glass-card rounded-2xl p-8">
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
                {/* Success ring */}
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
                  <h2
                    className="text-xl font-bold text-text-primary"
                    style={{ fontFamily: "var(--font-plus-jakarta, inherit)" }}
                  >
                    Check your email
                  </h2>
                  <p className="text-sm text-text-secondary mt-2 leading-relaxed">
                    We&apos;ve sent a reset link to{" "}
                    <span className="font-semibold text-text-primary">{email}</span>. Check your inbox and spam folder.
                  </p>
                </div>

                <Link
                  href="/login"
                  className="btn-ghost w-full flex items-center justify-center gap-2"
                  style={{ borderRadius: "10px", height: "40px" }}
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  Back to Login
                </Link>

                <p className="text-xs text-text-secondary">
                  Didn&apos;t receive it?{" "}
                  <button
                    onClick={() => { setFormState("idle"); }}
                    className="font-semibold text-text-primary hover:underline"
                  >
                    Click to resend
                  </button>
                </p>
              </motion.div>
            ) : (
              <motion.div key="form">
                {/* Error banner */}
                <AnimatePresence>
                  {formState === "error" && (
                    <motion.div
                      key="err"
                      initial={{ opacity: 0, y: -8, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: -8, height: 0 }}
                      className="mb-5 bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-3"
                    >
                      <span className="material-symbols-outlined text-status-error text-[18px] mt-0.5 shrink-0">error</span>
                      <p className="text-sm text-red-700">{errorMessage}</p>
                    </motion.div>
                  )}
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
                    style={{ borderRadius: "10px" }}
                  >
                    {formState === "loading" ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Sending…
                      </>
                    ) : (
                      "Send reset link"
                    )}
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
        </motion.div>
      </motion.main>
    </div>
  );
}
