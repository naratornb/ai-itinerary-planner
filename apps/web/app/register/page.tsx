"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { supabase } from "../../lib/supabase/client";
import { AuthShell, ErrorBanner, Spinner } from "../auth-ui";

type FormState = "idle" | "loading" | "success" | "error";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldError, setFieldError] = useState("");

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
    <AuthShell
      icon="database"
      title="Create an account"
      subtitle={<>Enter your details to get started with <span className="font-semibold text-text-primary">Supabase Admin</span>.</>}
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
            <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <span
                className="material-symbols-outlined text-status-active text-[32px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">Account created!</h2>
              <p className="text-sm text-text-secondary mt-2 leading-relaxed">
                Your account for{" "}
                <span className="font-semibold text-text-primary">{email}</span> is ready. You can sign in now.
              </p>
            </div>
            <button onClick={() => router.push("/login")} className="btn-primary w-full">
              Sign in
            </button>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-text-primary transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}>
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </div>

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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-text-primary transition-colors"
                    aria-label={showConfirm ? "Hide password" : "Show password"}>
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
              >
                {formState === "loading" ? (<><Spinner /> Creating account…</>) : "Create account"}
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
    </AuthShell>
  );
}
