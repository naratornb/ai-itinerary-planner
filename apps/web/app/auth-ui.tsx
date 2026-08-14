"use client";

import { motion, type Variants } from "framer-motion";

export const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

export const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

export function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export function ErrorBanner({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ duration: 0.25 }}
      className="mb-5 bg-red-50 border border-red-200 rounded-xl p-3.5 flex items-start gap-3"
    >
      <span className="material-symbols-outlined text-status-error text-[18px] mt-0.5 shrink-0">error</span>
      <div className="flex-1 min-w-0">
        {title && <p className="text-sm font-semibold text-red-800">{title}</p>}
        <p className={title ? "text-xs text-red-700 mt-0.5 leading-relaxed" : "text-sm text-red-700"}>
          {children}
        </p>
      </div>
    </motion.div>
  );
}

export function AuthShell({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-bg min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(100,116,139,0.1) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)" }}
      />

      <motion.main variants={container} initial="hidden" animate="show" className="relative w-full max-w-[420px]">
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
              {icon}
            </span>
          </div>
          <h1 className="text-[28px] font-extrabold text-text-primary tracking-[-0.03em]">
            {title}
          </h1>
          <p className="text-sm text-text-secondary mt-1.5 text-center max-w-xs">{subtitle}</p>
        </motion.div>

        <motion.div variants={item} className="glass-card rounded-2xl p-8">
          {children}
        </motion.div>
      </motion.main>
    </div>
  );
}
