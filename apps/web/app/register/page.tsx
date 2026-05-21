"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail]                   = useState("");
  const [password, setPassword]             = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword]     = useState(false);
  const [showConfirm, setShowConfirm]       = useState(false);
  const [formState, setFormState]           = useState<FormState>("idle");
  const [errorMessage, setErrorMessage]     = useState("");
  const [fieldError, setFieldError]         = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setFieldError("");

    if (password !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setFieldError("Password must be at least 8 characters.");
      return;
    }

    setFormState("loading");
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setErrorMessage(error.message); setFormState("error"); return; }
      setFormState("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Registration failed.");
      setFormState("error");
    }
  };

  return (
    <div className="auth-bg min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(100,116,139,0.09) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 w-[480px] h-[480px] rounded-full"
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
              database
            </span>
          </div>
          <h1
            className="text-[28px] font-extrabold tracking-tight text-text-primary"
            style={{ fontFamily: "var(--font-plus-jakarta, inherit)", letterSpacing: "-0.03em" }}
          >
            Create an account
          </h1>
          <p className="text-sm text-text-secondary mt-1.5 text-center">
            Enter your details to get started with{" "}
            <span className="font-semibold text-text-primary">Supabase Admin</span>.
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
                <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                  <span
                    className="material-symbols-outlined text-status-active text-[32px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    mark_email_read
                  </span>
                </div>
                <div>
                  <h2
                    className="text-xl font-bold text-text-primary"
                    style={{ fontFamily: "var(--font-plus-jakarta, inherit)" }}
                  >
                    Account created!
                  </h2>
                  <p className="text-sm text-text-secondary mt-2 leading-relaxed">
                    We&apos;ve sent a verification email to{" "}
                    <span className="font-semibold text-text-primary">{email}</span>. Please check your inbox before logging in.
                  </p>
                </div>
                <button
                  onClick={() => router.push("/login")}
                  className="btn-primary w-full"
                  style={{ borderRadius: "10px" }}
                >
                  Go to Login
                </button>
              </motion.div>
            ) : (
              <motion.div key="form">
                {/* Error banner */}
                <AnimatePresence>
                  {(formState === "error" || fieldError) && (
                    <motion.div
                      key="err"
                      initial={{ opacity: 0, y: -8, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: -8, height: 0 }}
                      className="mb-5 bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-3"
                    >
                      <span className="material-symbols-outlined text-status-error text-[18px] mt-0.5 shrink-0">error</span>
                      <p className="text-sm text-red-700">{fieldError || errorMessage}</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                  {/* Email */}
                  <div>
                    <label className="form-label" htmlFor="email">Email address</label>
                    <input
                      id="email"
                      type="email"
                      className="form-input"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label className="form-label" htmlFor="password">Password</label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        className="form-input pr-10"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        minLength={8}
                      />
                      <button type="button" onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-text-primary transition-colors">
                        <span className="material-symbols-outlined text-[18px]">
                          {showPassword ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <label className="form-label" htmlFor="confirm-password">Confirm password</label>
                    <div className="relative">
                      <input
                        id="confirm-password"
                        type={showConfirm ? "text" : "password"}
                        className={`form-input pr-10 ${fieldError ? "error" : ""}`}
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                      />
                      <button type="button" onClick={() => setShowConfirm((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-text-primary transition-colors">
                        <span className="material-symbols-outlined text-[18px]">
                          {showConfirm ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                    </div>
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
                    style={{ borderRadius: "10px" }}
                  >
                    {formState === "loading" ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Creating account…
                      </>
                    ) : (
                      "Create account"
                    )}
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {formState !== "success" && (
            <div className="mt-6 pt-6 border-t border-border-subtle text-center">
              <p className="text-sm text-text-secondary">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-semibold text-text-primary hover:underline underline-offset-2 transition-colors"
                >
                  Log in
                </Link>
              </p>
            </div>
          )}
        </motion.div>
      </motion.main>
    </div>
  );
}
