"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase/client";

type UserRow = {
  id: string;
  username: string;
  role: string;
  email?: string;
  status?: string;
  createdAt?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

const AVATAR_COLORS = [
  { bg: "#dae2fd", fg: "#3f465c" },
  { bg: "#fcdeb5", fg: "#574425" },
  { bg: "#80f984", fg: "#005315" },
  { bg: "#e4e2e4", fg: "#45464d" },
  { bg: "#bec6e0", fg: "#3f465c" },
];

function getAvatarStyle(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function StatusBadge({ status }: { status?: string }) {
  const map: Record<string, { dot: string; label: string }> = {
    active:    { dot: "#10b981", label: "Active" },
    invited:   { dot: "#f59e0b", label: "Invited" },
    suspended: { dot: "#94a3b8", label: "Suspended" },
  };
  const s = map[status || "active"] ?? map.active;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="status-dot" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

function RolePill({ role }: { role: string }) {
  const isAdmin = role === "admin" || role === "administrator";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wider"
      style={
        isAdmin
          ? { background: "#dae2fd", color: "#3f465c", border: "1px solid #bec6e0" }
          : { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }
      }
    >
      {role}
    </span>
  );
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <div className="skeleton h-4 rounded-md" style={{ width: i === 0 ? "120px" : "80px" }} />
        </td>
      ))}
    </tr>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers]               = useState<UserRow[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [role, setRole]                 = useState("member");
  const [filter, setFilter]             = useState("");
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [editEmail, setEditEmail]       = useState("");
  const [editStatus, setEditStatus]     = useState("active");
  const [editCreatedAt, setEditCreatedAt] = useState("");
  const [isSaving, setIsSaving]         = useState(false);

  const isAdmin = role === "admin";

  // Auth state
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setRole((data.session?.user?.app_metadata?.role as string) || "member");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setRole((session?.user?.app_metadata?.role as string) || "member");
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  // Load users
  const loadUsers = async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const res = await fetch(`${API_URL}/users`);
      if (!res.ok) throw new Error("Failed to load users.");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Unable to fetch users.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  // Populate drawer on select
  useEffect(() => {
    if (!selectedUser) { setDrawerOpen(false); return; }
    setEditEmail(selectedUser.email || "");
    setEditStatus(selectedUser.status || "active");
    setEditCreatedAt(selectedUser.createdAt || "");
    setDrawerOpen(true);
  }, [selectedUser]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const handleSave = async () => {
    if (!selectedUser) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${API_URL}/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: editEmail, status: editStatus, createdAt: editCreatedAt }),
      });
      if (!res.ok) throw new Error("Unable to save changes.");
      await loadUsers();
      setSelectedUser(null);
      toast.success("User updated", { description: `${selectedUser.username} saved successfully.` });
    } catch (err) {
      toast.error("Save failed", { description: err instanceof Error ? err.message : "Unknown error." });
    } finally {
      setIsSaving(false);
    }
  };

  const closeDrawer = () => { setDrawerOpen(false); setTimeout(() => setSelectedUser(null), 280); };

  const filteredUsers = useMemo(() =>
    users.filter(u =>
      !filter ||
      u.username.toLowerCase().includes(filter.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(filter.toLowerCase())
    ), [users, filter]
  );

  const colCount = isAdmin ? 6 : 2;

  return (
    <div className="bg-surface-alt font-body-base text-text-primary h-screen flex overflow-hidden">

      {/* ── Sidebar ── */}
      <nav
        className="h-full w-[220px] border-r border-border-subtle flex flex-col gap-1 p-4 shrink-0"
        style={{ background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)" }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-3 py-3 mb-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #0f172a 0%, #334155 100%)", boxShadow: "0 2px 8px rgba(15,23,42,0.25)" }}
          >
            <span className="material-symbols-outlined text-white text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>token</span>
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-bold text-text-primary truncate" style={{ fontFamily: "var(--font-plus-jakarta, inherit)" }}>Project Alpha</span>
            <span className="text-[11px] text-text-secondary">Authentication</span>
          </div>
        </div>

        <div className="flex flex-col gap-0.5">
          <button className="nav-item active">
            <span className="material-symbols-outlined text-[18px]">group</span>
            <span>Users</span>
          </button>
          <button className="nav-item">
            <span className="material-symbols-outlined text-[18px]">history</span>
            <span>Auth Logs</span>
          </button>
          <button className="nav-item">
            <span className="material-symbols-outlined text-[18px]">security</span>
            <span>Policies</span>
          </button>
          <button className="nav-item">
            <span className="material-symbols-outlined text-[18px]">settings</span>
            <span>Settings</span>
          </button>
        </div>

        <div className="mt-auto">
          <button onClick={handleSignOut} className="nav-item w-full text-status-error hover:bg-red-50">
            <span className="material-symbols-outlined text-[18px]">logout</span>
            <span>Sign out</span>
          </button>
        </div>
      </nav>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Top bar */}
        <header className="bg-white border-b border-border-subtle flex justify-between items-center px-6 h-14 shrink-0">
          <div className="flex items-center gap-5 flex-1">
            <span
              className="text-lg font-bold text-text-primary tracking-tight"
              style={{ fontFamily: "var(--font-plus-jakarta, inherit)", letterSpacing: "-0.02em" }}
            >
              Supabase Admin
            </span>
            <div className="relative max-w-xs w-full hidden md:block">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-[16px]">search</span>
              <input
                className="w-full h-8 pl-9 pr-10 bg-surface-alt border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
                placeholder="Search resources…"
                type="text"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-[10px] text-text-secondary font-semibold">
                <kbd className="px-1 py-0.5 border border-border-subtle rounded bg-white text-[10px]">⌘</kbd>
                <kbd className="px-1 py-0.5 border border-border-subtle rounded bg-white text-[10px]">K</kbd>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-50 rounded-lg transition-colors">
              <span className="material-symbols-outlined text-[20px]">help</span>
            </button>
            <button className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-slate-50 rounded-lg transition-colors relative">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-status-active rounded-full border-2 border-white" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-[1200px] mx-auto flex flex-col gap-5">

            {/* Page header */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col md:flex-row md:items-end justify-between gap-4"
            >
              <div>
                <h1
                  className="text-[22px] font-bold text-text-primary"
                  style={{ fontFamily: "var(--font-plus-jakarta, inherit)", letterSpacing: "-0.02em" }}
                >
                  User Management
                </h1>
                <p className="text-sm text-text-secondary mt-0.5">Manage access, roles, and user lifecycle events.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-56">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-[16px]">filter_list</span>
                  <input
                    className="w-full h-9 pl-9 pr-3 bg-white border border-border-subtle rounded-lg text-sm text-text-primary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
                    placeholder="Filter users…"
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <button
                  onClick={loadUsers}
                  className="btn-ghost h-9 px-3 gap-2"
                  style={{ borderRadius: "8px" }}
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                  Refresh
                </button>
                {isAdmin && (
                  <button
                    className="btn-primary h-9 px-3 gap-1.5"
                    style={{ borderRadius: "8px", fontSize: "13px" }}
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Invite User
                  </button>
                )}
              </div>
            </motion.div>

            {/* Table card */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="solid-card rounded-xl overflow-hidden flex flex-col"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[580px]">
                  <thead>
                    <tr className="border-b border-border-subtle" style={{ background: "#fafafa" }}>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Username / ID</th>
                      <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Role</th>
                      {isAdmin && (
                        <>
                          <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Email</th>
                          <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Status</th>
                          <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-widest text-text-secondary">Created At</th>
                          <th className="py-3 px-4 text-[11px] font-semibold uppercase tracking-widest text-text-secondary text-right">Actions</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="text-sm text-text-primary divide-y divide-border-subtle">
                    {isLoading && Array.from({ length: 5 }).map((_, i) => (
                      <SkeletonRow key={i} cols={colCount} />
                    ))}

                    {!isLoading && errorMessage && (
                      <tr>
                        <td colSpan={colCount} className="py-12 px-4 text-center">
                          <div className="flex flex-col items-center gap-3 text-status-error">
                            <span className="material-symbols-outlined text-[36px]" style={{ fontVariationSettings: "'FILL' 1" }}>error_circle</span>
                            <p className="text-sm font-medium">{errorMessage}</p>
                            <button onClick={loadUsers} className="btn-ghost h-8 px-3 text-xs" style={{ borderRadius: "6px" }}>
                              Retry
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {!isLoading && !errorMessage && filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={colCount} className="py-12 px-4 text-center">
                          <div className="flex flex-col items-center gap-2 text-text-secondary">
                            <span className="material-symbols-outlined text-[36px]">person_off</span>
                            <p className="text-sm">{filter ? "No users match your filter." : "No users found."}</p>
                          </div>
                        </td>
                      </tr>
                    )}

                    {!isLoading && !errorMessage && filteredUsers.map((user, idx) => {
                      const av = getAvatarStyle(user.username);
                      const isSuspended = user.status === "suspended";
                      return (
                        <motion.tr
                          key={user.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: idx * 0.04, ease: "easeOut" }}
                          className="table-row-hover group"
                          style={{ opacity: isSuspended ? 0.55 : 1 }}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs shrink-0"
                                style={{ background: av.bg, color: av.fg }}
                              >
                                {user.username.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="flex flex-col">
                                <span className={`font-medium ${isSuspended ? "line-through" : ""}`}>{user.username}</span>
                                <span className="text-[11px] text-text-secondary font-mono">{user.id.slice(0, 8)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4"><RolePill role={user.role} /></td>
                          {isAdmin && (
                            <>
                              <td className="py-3 px-4 text-text-secondary">{user.email}</td>
                              <td className="py-3 px-4"><StatusBadge status={user.status} /></td>
                              <td className="py-3 px-4 text-text-secondary text-[13px]">{user.createdAt || "—"}</td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => setSelectedUser(user)}
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-sm font-medium text-text-secondary hover:text-primary border border-transparent hover:border-border-subtle px-2.5 py-1 rounded-md hover:bg-white hover:shadow-sm"
                                >
                                  Edit
                                </button>
                              </td>
                            </>
                          )}
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="border-t border-border-subtle px-4 py-2.5 flex items-center justify-between bg-white">
                <span className="text-xs text-text-secondary">
                  {isLoading ? "Loading…" : `Showing ${filteredUsers.length} of ${users.length} users`}
                </span>
                <div className="flex items-center gap-1">
                  <button className="p-1.5 text-text-secondary disabled:opacity-40 hover:text-primary transition-colors rounded-md" disabled>
                    <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                  </button>
                  <button className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-md">
                    <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Footer */}
            <footer className="text-[11px] text-text-secondary flex justify-between items-center py-2">
              <span>© 2025 Supabase Prototype. Built for administrative efficiency.</span>
              <div className="flex gap-4">
                <button className="hover:text-text-primary transition-colors">Documentation</button>
                <button className="hover:text-text-primary transition-colors">Support</button>
                <button className="hover:text-text-primary transition-colors">API Status</button>
              </div>
            </footer>
          </div>
        </main>
      </div>

      {/* ── Backdrop ── */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={closeDrawer}
          />
        )}
      </AnimatePresence>

      {/* ── Edit Drawer ── */}
      <AnimatePresence>
        {drawerOpen && selectedUser && (
          <motion.aside
            key="drawer"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[400px] bg-white border-l border-border-subtle shadow-2xl flex flex-col"
          >
            {/* Drawer header */}
            <div className="h-14 px-5 border-b border-border-subtle flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs"
                  style={{ background: getAvatarStyle(selectedUser.username).bg, color: getAvatarStyle(selectedUser.username).fg }}
                >
                  {selectedUser.username.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary leading-tight">Edit User</p>
                  <p className="text-[11px] text-text-secondary font-mono leading-tight">{selectedUser.id.slice(0, 12)}</p>
                </div>
              </div>
              <button
                onClick={closeDrawer}
                className="w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-slate-50 rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
              {/* Identity section */}
              <section className="flex flex-col gap-4">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary border-b border-border-subtle pb-2">
                  Identity & Access
                </h3>
                <div>
                  <label className="form-label" htmlFor="edit-email">Email Address</label>
                  <input
                    id="edit-email"
                    type="email"
                    className="form-input"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="edit-status">Account Status</label>
                  <div className="flex gap-3 mt-1">
                    {["active", "invited", "suspended"].map((s) => (
                      <label key={s} className="flex items-center gap-1.5 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="status"
                          value={s}
                          checked={editStatus === s}
                          onChange={() => setEditStatus(s)}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className={s === "suspended" ? "text-status-error" : "text-text-primary"}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="form-label" htmlFor="edit-created-at">Created At</label>
                  <input
                    id="edit-created-at"
                    type="text"
                    className="form-input font-mono text-sm"
                    value={editCreatedAt}
                    onChange={(e) => setEditCreatedAt(e.target.value)}
                  />
                </div>
              </section>

              {/* Read-only metadata */}
              <section className="flex flex-col gap-3 bg-surface-alt p-4 rounded-xl border border-border-subtle">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">System Metadata</h3>
                <div className="flex flex-col gap-2">
                  {[
                    { label: "User ID",  value: selectedUser.id },
                    { label: "Username", value: selectedUser.username },
                    { label: "Role",     value: selectedUser.role },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-1 border-b border-border-subtle/60 last:border-0">
                      <span className="text-xs text-text-secondary">{label}</span>
                      <span className="font-mono text-xs text-text-primary truncate max-w-[200px]">{value}</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Danger */}
              <div className="mt-auto pt-4">
                <button className="w-full h-9 flex items-center justify-center gap-2 border border-red-200 text-status-error hover:bg-red-50 rounded-lg text-sm font-medium transition-colors">
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  Delete User Data
                </button>
              </div>
            </div>

            {/* Drawer footer */}
            <div className="p-5 border-t border-border-subtle bg-white shrink-0 flex gap-3">
              <button
                onClick={closeDrawer}
                className="btn-ghost flex-1"
                style={{ borderRadius: "10px", height: "40px" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="btn-primary flex-1"
                style={{ borderRadius: "10px", height: "40px" }}
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Saving…
                  </>
                ) : "Save Changes"}
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
