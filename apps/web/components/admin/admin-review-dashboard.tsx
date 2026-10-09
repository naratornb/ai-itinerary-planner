"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  AdminApiError,
  deleteAdminPackage,
  fetchAdminUsers,
  fetchPendingApprovals,
  fetchReviewedApprovals,
  type AdminApprovalPackage,
  type AdminUser,
  type ApprovalListResponse,
  type ApprovalSort,
} from "../../lib/admin-api";
import { STATUS_LABELS } from "../../lib/creator-api";
import { creatorPackageStatusStyle } from "../migrated-screens";
import { AdminHeader } from "./admin-header";
import {
  approvalResultRange,
  creatorLabel,
  formatAdminDestination,
  formatAdminDuration,
  formatAdminPrice,
  formatSubmittedAt,
  formatWaitingAge,
  optionalAdminUsers,
  requestSequenceIsCurrent,
} from "../../lib/admin-review";
import { adminApprovalRoute, APP_ROUTES } from "../../lib/routes";
import { supabase } from "../../lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const EMPTY_META: ApprovalListResponse["meta"] = {
  total: 0,
  page: 1,
  per_page: DEFAULT_PAGE_SIZE,
  total_pages: 0,
};

type DashboardStatus = "loading" | "ready" | "empty" | "forbidden" | "error";

type DashboardTab = "pending" | "reviewed";

export type AdminReviewDashboardViewProps = {
  status: DashboardStatus;
  initialTab?: DashboardTab;
  packages: AdminApprovalPackage[];
  meta: ApprovalListResponse["meta"];
  sort: ApprovalSort;
  perPage: number;
  oldestSubmittedAt: string | null;
  users: AdminUser[];
  now?: Date | string;
  isUpdating: boolean;
  errorMessage?: string;
  reviewedPackages: AdminApprovalPackage[];
  reviewedMeta: ApprovalListResponse["meta"];
  reviewedError?: string;
  pendingDelete: AdminApprovalPackage | null;
  deleteError?: string;
  isDeleting: boolean;
  onSortChange: (sort: ApprovalSort) => void;
  onPerPageChange: (perPage: number) => void;
  onPageChange: (page: number) => void;
  onReviewedPageChange: (page: number) => void;
  onDeleteRequest: (pkg: AdminApprovalPackage) => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

export function dashboardSessionAction(accessToken: string | null | undefined) {
  return accessToken
    ? ({ type: "load", accessToken } as const)
    : ({ type: "redirect" } as const);
}

export function dashboardFailure(error: unknown) {
  if (error instanceof AdminApiError && error.kind === "unauthenticated") {
    return { type: "redirect" } as const;
  }
  if (error instanceof AdminApiError && error.kind === "forbidden") {
    return { type: "forbidden" } as const;
  }
  return {
    type: "error",
    message: error instanceof Error ? error.message : "Unable to load the review queue.",
  } as const;
}

export function nextDashboardPage(
  currentPage: number,
  response: ApprovalListResponse,
): number {
  return response.data.length === 0 && currentPage > 1 ? currentPage - 1 : currentPage;
}

export function loadQueueEnhancements(
  usersRequest: Promise<AdminUser[]>,
  oldestRequest: Promise<string | null>,
  isCurrent: () => boolean,
  onUsers: (users: AdminUser[]) => void,
  onOldest: (submittedAt: string | null) => void,
) {
  void optionalAdminUsers(usersRequest).then((creatorUsers) => {
    if (isCurrent()) onUsers(creatorUsers);
  });
  void oldestRequest.catch(() => null).then((oldest) => {
    if (isCurrent()) onOldest(oldest);
  });
}

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...ICON} strokeWidth={2.5}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function SummaryCards({
  total,
  reviewedTotal,
  oldestSubmittedAt,
  now,
}: {
  total: number;
  reviewedTotal: number;
  oldestSubmittedAt: string | null;
  now?: Date | string;
}) {
  return (
    <section className="admin-review-summary" aria-label="Review queue summary">
      <article className="admin-review-summary__card">
        <span>Pending review</span>
        <strong>{total}</strong>
        <p>Waiting for an administrator</p>
      </article>
      <article className="admin-review-summary__card">
        <span>Oldest waiting</span>
        <strong>{formatWaitingAge(oldestSubmittedAt, now)}</strong>
        <p>Earliest available submission</p>
      </article>
      <article className="admin-review-summary__card">
        <span>Reviewed</span>
        <strong>{reviewedTotal}</strong>
        <p>Approved, rejected or live</p>
      </article>
    </section>
  );
}

function PackageMeta({ pkg, now }: { pkg: AdminApprovalPackage; now?: Date | string }) {
  const waitingAge = formatWaitingAge(pkg.submitted_at, now);
  return (
    <>
      <span>{formatSubmittedAt(pkg.submitted_at)}</span>
      {waitingAge === "Not available" ? null : <small>{waitingAge} waiting</small>}
    </>
  );
}

function ReviewLink({ pkg }: { pkg: AdminApprovalPackage }) {
  return (
    <Link
      className="admin-review-row-button"
      href={adminApprovalRoute(pkg.package_id)}
      aria-label={`Review ${pkg.title}`}
    >
      Review
    </Link>
  );
}

function QueueTable({ packages, users, now }: Pick<AdminReviewDashboardViewProps, "packages" | "users" | "now">) {
  return (
    <div className="admin-review-table-wrap">
      <table className="admin-review-table">
        <caption className="admin-review-sr-only">Packages waiting for review</caption>
        <thead>
          <tr>
            <th scope="col">Package</th>
            <th scope="col">Destination</th>
            <th scope="col">Creator</th>
            <th scope="col">Submitted</th>
            <th scope="col" className="admin-review-num">Duration</th>
            <th scope="col" className="admin-review-num">Price</th>
            <th scope="col"><span className="admin-review-sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
            <tr key={pkg.package_id}>
              <td>
                <Link className="dashboard-package-link" href={adminApprovalRoute(pkg.package_id)} title={pkg.title}>
                  <span>{pkg.title}</span>
                  <ArrowIcon />
                </Link>
              </td>
              <td>{formatAdminDestination(pkg)}</td>
              <td>{creatorLabel(pkg.creator_id, users)}</td>
              <td className="admin-review-submitted"><PackageMeta pkg={pkg} now={now} /></td>
              <td className="admin-review-num">{formatAdminDuration(pkg.duration_days)}</td>
              <td className="admin-review-num admin-review-price">{formatAdminPrice(pkg.base_price_aud)}</td>
              <td className="admin-review-action-cell"><ReviewLink pkg={pkg} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = creatorPackageStatusStyle(status);
  return (
    <span className="admin-review-status" style={{ color: style.color, background: style.background }}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function Pagination({
  label, meta, visibleCount, onPageChange,
}: {
  label: string;
  meta: ApprovalListResponse["meta"];
  visibleCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav className="admin-review-pagination" aria-label={label}>
      <span aria-live="polite">{approvalResultRange(meta, visibleCount)}</span>
      <div>
        <span>Page {meta.page} of {Math.max(1, meta.total_pages)}</span>
        <button className="admin-review-secondary-button" type="button" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>Previous</button>
        <button className="admin-review-secondary-button" type="button" disabled={meta.page >= meta.total_pages} onClick={() => onPageChange(meta.page + 1)}>Next</button>
      </div>
    </nav>
  );
}

type ReviewedSectionProps = Pick<
  AdminReviewDashboardViewProps,
  "reviewedPackages" | "reviewedMeta" | "reviewedError" | "users" | "isDeleting"
> & {
  onPageChange: (page: number) => void;
  onDeleteRequest: (pkg: AdminApprovalPackage) => void;
};

// Packages already decided (approved/rejected/live) — admins can remove stale
// ones here; pending submissions are not deletable from the queue.
function ReviewedSection({
  reviewedPackages, reviewedMeta, reviewedError, users, onPageChange, onDeleteRequest,
}: ReviewedSectionProps) {
  const rowActions = (pkg: AdminApprovalPackage) => (
    <div className="admin-review-row-actions">
      <Link
        className="dashboard-row-action"
        href={adminApprovalRoute(pkg.package_id)}
        aria-label={`View ${pkg.title}`}
        title="View"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" {...ICON}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>
      </Link>
      <button
        type="button"
        className="dashboard-row-action dashboard-row-action-delete"
        aria-label={`Delete ${pkg.title}`}
        title="Delete"
        onClick={() => onDeleteRequest(pkg)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" {...ICON}><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-.867 12.142A2 2 0 0 1 16.138 20H7.862a2 2 0 0 1-1.995-1.858L5 6" /><path d="M10 11v6M14 11v6" /></svg>
      </button>
    </div>
  );

  return (
    <>
      <h2 className="admin-review-sr-only">Reviewed packages</h2>
      {reviewedError ? (
        <p className="admin-review-history-error" role="alert">{reviewedError}</p>
      ) : reviewedPackages.length === 0 ? (
        <p className="admin-review-history-empty">No packages have been reviewed yet.</p>
      ) : (
        <>
          <div className="admin-review-table-wrap">
            <table className="admin-review-table">
              <caption className="admin-review-sr-only">Packages already reviewed</caption>
              <thead>
                <tr>
                  <th scope="col">Package</th>
                  <th scope="col">Destination</th>
                  <th scope="col">Status</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Submitted</th>
                  <th scope="col" className="admin-review-num">Price</th>
                  <th scope="col"><span className="admin-review-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {reviewedPackages.map((pkg) => (
                  <tr key={pkg.package_id}>
                    <td>
                      <Link className="dashboard-package-link" href={adminApprovalRoute(pkg.package_id)} title={pkg.title}>
                        <span>{pkg.title}</span>
                        <ArrowIcon />
                      </Link>
                    </td>
                    <td>{formatAdminDestination(pkg)}</td>
                    <td><StatusBadge status={pkg.status} /></td>
                    <td>{creatorLabel(pkg.creator_id, users)}</td>
                    <td className="admin-review-submitted"><span>{formatSubmittedAt(pkg.submitted_at)}</span></td>
                    <td className="admin-review-num admin-review-price">{formatAdminPrice(pkg.base_price_aud)}</td>
                    <td className="admin-review-action-cell">{rowActions(pkg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section className="admin-review-cards" aria-label="Reviewed packages for mobile">
            {reviewedPackages.map((pkg) => (
              <article className="admin-review-card" key={pkg.package_id}>
                <div className="admin-review-card__heading">
                  <h3>{pkg.title}</h3>
                  <StatusBadge status={pkg.status} />
                </div>
                <dl>
                  <div><dt>Destination</dt><dd>{formatAdminDestination(pkg)}</dd></div>
                  <div><dt>Creator</dt><dd>{creatorLabel(pkg.creator_id, users)}</dd></div>
                  <div><dt>Submitted</dt><dd>{formatSubmittedAt(pkg.submitted_at)}</dd></div>
                  <div><dt>Price</dt><dd className="admin-review-price">{formatAdminPrice(pkg.base_price_aud)}</dd></div>
                </dl>
                {rowActions(pkg)}
              </article>
            ))}
          </section>

          <Pagination
            label="Reviewed packages pagination"
            meta={reviewedMeta}
            visibleCount={reviewedPackages.length}
            onPageChange={onPageChange}
          />
        </>
      )}
    </>
  );
}

function DeletePackageDialog({
  pkg, error, isDeleting, onConfirm, onCancel,
}: {
  pkg: AdminApprovalPackage;
  error?: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="delete-day-backdrop" role="presentation" onMouseDown={() => !isDeleting && onCancel()}>
      <section
        className="delete-day-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-delete-title"
        aria-describedby="admin-delete-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="admin-delete-title">Delete &ldquo;{pkg.title}&rdquo;?</h2>
        <p id="admin-delete-description">
          This {STATUS_LABELS[pkg.status]?.toLowerCase() ?? pkg.status} package will be permanently deleted, along with its itinerary and photos. This cannot be undone.
        </p>
        {error && <p role="alert" className="admin-review-dialog-error">{error}</p>}
        <div className="delete-day-actions">
          <button className="quiet-button" autoFocus disabled={isDeleting} onClick={onCancel}>Cancel</button>
          <button className="confirm-delete-button" disabled={isDeleting} onClick={onConfirm}>
            {isDeleting ? "Deleting…" : "Delete package"}
          </button>
        </div>
      </section>
    </div>
  );
}

function QueueCards({ packages, users, now }: Pick<AdminReviewDashboardViewProps, "packages" | "users" | "now">) {
  return (
    <section className="admin-review-cards" aria-label="Pending review packages for mobile">
      {packages.map((pkg) => (
        <article className="admin-review-card" key={pkg.package_id}>
          <div className="admin-review-card__heading">
            <h3>{pkg.title}</h3>
          </div>
          <dl>
            <div><dt>Destination</dt><dd>{formatAdminDestination(pkg)}</dd></div>
            <div><dt>Creator</dt><dd>{creatorLabel(pkg.creator_id, users)}</dd></div>
            <div><dt>Submitted</dt><dd className="admin-review-submitted"><PackageMeta pkg={pkg} now={now} /></dd></div>
            <div><dt>Duration</dt><dd>{formatAdminDuration(pkg.duration_days)}</dd></div>
            <div><dt>Price</dt><dd className="admin-review-price">{formatAdminPrice(pkg.base_price_aud)}</dd></div>
          </dl>
          <ReviewLink pkg={pkg} />
        </article>
      ))}
    </section>
  );
}

const TAB_ORDER: DashboardTab[] = ["pending", "reviewed"];

function QueueTabs({
  tab, pendingTotal, reviewedTotal, onChange,
}: {
  tab: DashboardTab;
  pendingTotal: number;
  reviewedTotal: number;
  onChange: (tab: DashboardTab) => void;
}) {
  const labels: Record<DashboardTab, { text: string; count: number }> = {
    pending: { text: "Pending review", count: pendingTotal },
    reviewed: { text: "Reviewed", count: reviewedTotal },
  };
  // Roving tabindex: arrow keys move between tabs, Tab leaves the tablist.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TAB_ORDER[(TAB_ORDER.indexOf(tab) + step + TAB_ORDER.length) % TAB_ORDER.length];
    onChange(next);
    document.getElementById(`admin-review-tab-${next}`)?.focus();
  };
  return (
    <div className="admin-review-tabs" role="tablist" aria-label="Review dashboard sections">
      {TAB_ORDER.map((key) => (
        <button
          key={key}
          id={`admin-review-tab-${key}`}
          type="button"
          role="tab"
          className="admin-review-tab"
          aria-selected={tab === key}
          aria-controls={`admin-review-panel-${key}`}
          tabIndex={tab === key ? 0 : -1}
          onClick={() => onChange(key)}
          onKeyDown={onKeyDown}
        >
          {labels[key].text}
          <span className="admin-review-tab__count">{labels[key].count}</span>
        </button>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="admin-review-loading" aria-busy="true" aria-label="Loading review queue">
      <section className="admin-review-summary" aria-hidden="true">
        <div className="admin-review-skeleton admin-review-skeleton--summary" />
        <div className="admin-review-skeleton admin-review-skeleton--summary" />
        <div className="admin-review-skeleton admin-review-skeleton--summary" />
      </section>
      <div className="admin-review-skeleton admin-review-skeleton--controls" aria-hidden="true" />
      <div className="admin-review-skeleton admin-review-skeleton--queue" aria-hidden="true" />
      <span className="admin-review-sr-only">Loading packages waiting for review.</span>
    </div>
  );
}

function StatePanel({
  title,
  children,
  role,
}: {
  title: string;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <section className="admin-review-state" role={role}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function AdminReviewDashboardView(props: AdminReviewDashboardViewProps): ReactNode {
  const {
    status,
    initialTab = "pending",
    packages,
    meta,
    sort,
    perPage,
    oldestSubmittedAt,
    users,
    now,
    isUpdating,
    errorMessage,
    reviewedPackages,
    reviewedMeta,
    reviewedError,
    pendingDelete,
    deleteError,
    isDeleting,
    onSortChange,
    onPerPageChange,
    onPageChange,
    onReviewedPageChange,
    onDeleteRequest,
    onDeleteConfirm,
    onDeleteCancel,
    onRefresh,
    onSignOut,
  } = props;
  const [tab, setTab] = useState<DashboardTab>(initialTab);

  return (
    <div className="admin-review-page">
      <AdminHeader onSignOut={onSignOut} />

      <main className="admin-review-shell">
        <div className="admin-review-intro">
          <h1>Review dashboard</h1>
          <p>Review submitted packages and manage the ones already decided.</p>
        </div>
        <p className="admin-review-sr-only" role="status" aria-live="polite">
          {status === "loading"
            ? "Loading review queue."
            : isUpdating
              ? "Updating review queue."
              : status === "ready" || status === "empty"
                ? "Review queue updated."
                : ""}
        </p>

        {status === "loading" ? <LoadingState /> : null}

        {status === "forbidden" ? (
          <StatePanel title="Administrator access required" role="alert">
            <p>This account cannot open the review queue.</p>
            <Link className="admin-review-secondary-link" href={APP_ROUTES.marketplace}>Back to marketplace</Link>
          </StatePanel>
        ) : null}

        {status === "error" ? (
          <StatePanel title="The review queue could not be loaded" role="alert">
            <p>{errorMessage || "Please check the connection and try again."}</p>
            <button className="admin-review-primary-button" type="button" onClick={onRefresh}>Try again</button>
          </StatePanel>
        ) : null}

        {status === "ready" || status === "empty" ? (
          <>
            <SummaryCards
              total={meta.total}
              reviewedTotal={reviewedMeta.total}
              oldestSubmittedAt={oldestSubmittedAt}
              now={now}
            />

            <section className="admin-review-queue" aria-label="Packages" aria-busy={isUpdating}>
              <div className="admin-review-toolbar">
                <QueueTabs tab={tab} pendingTotal={meta.total} reviewedTotal={reviewedMeta.total} onChange={setTab} />
                {tab === "pending" && status === "ready" ? (
                  <div className="admin-review-control-actions">
                    <label>
                      <span>Sort by</span>
                      <select
                        value={sort}
                        onChange={(event) => onSortChange(event.target.value as ApprovalSort)}
                      >
                        <option value="submitted_at_asc">Oldest first</option>
                        <option value="submitted_at_desc">Newest first</option>
                      </select>
                    </label>
                    <label className="admin-review-page-size">
                      <span>Rows</span>
                      <select
                        value={perPage}
                        onChange={(event) => onPerPageChange(Number(event.target.value))}
                      >
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      aria-label="Refresh queue"
                      className="admin-review-secondary-button admin-review-refresh-button"
                      type="button"
                      onClick={onRefresh}
                    >
                      <svg aria-hidden="true" className="admin-review-refresh-icon" viewBox="0 0 24 24" fill="none">
                        <path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" />
                      </svg>
                    </button>
                  </div>
                ) : null}
              </div>

              {tab === "pending" ? (
                <div role="tabpanel" id="admin-review-panel-pending" aria-labelledby="admin-review-tab-pending">
                  {status === "empty" ? (
                    <StatePanel title="All caught up" role="status">
                      <p>There are no packages waiting for review right now.</p>
                      <button className="admin-review-secondary-button" type="button" onClick={onRefresh}>Refresh queue</button>
                    </StatePanel>
                  ) : (
                    <>
                      <h2 className="admin-review-sr-only">Packages waiting for review</h2>
                      <QueueTable packages={packages} users={users} now={now} />
                      <QueueCards packages={packages} users={users} now={now} />
                      <Pagination
                        label="Review queue pagination"
                        meta={meta}
                        visibleCount={packages.length}
                        onPageChange={onPageChange}
                      />
                    </>
                  )}
                </div>
              ) : (
                <div role="tabpanel" id="admin-review-panel-reviewed" aria-labelledby="admin-review-tab-reviewed">
                  <ReviewedSection
                    reviewedPackages={reviewedPackages}
                    reviewedMeta={reviewedMeta}
                    reviewedError={reviewedError}
                    users={users}
                    isDeleting={isDeleting}
                    onPageChange={onReviewedPageChange}
                    onDeleteRequest={onDeleteRequest}
                  />
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>

      {pendingDelete ? (
        <DeletePackageDialog
          pkg={pendingDelete}
          error={deleteError}
          isDeleting={isDeleting}
          onConfirm={onDeleteConfirm}
          onCancel={onDeleteCancel}
        />
      ) : null}
    </div>
  );
}

export default function AdminReviewDashboard() {
  const router = useRouter();
  const activeRequest = useRef(0);
  const [status, setStatus] = useState<DashboardStatus>("loading");
  const [packages, setPackages] = useState<AdminApprovalPackage[]>([]);
  const [meta, setMeta] = useState<ApprovalListResponse["meta"]>(EMPTY_META);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [oldestSubmittedAt, setOldestSubmittedAt] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [sort, setSort] = useState<ApprovalSort>("submitted_at_asc");
  const [perPage, setPerPage] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const reviewedRequest = useRef(0);
  const [reviewedPackages, setReviewedPackages] = useState<AdminApprovalPackage[]>([]);
  const [reviewedMeta, setReviewedMeta] = useState<ApprovalListResponse["meta"]>(EMPTY_META);
  const [reviewedPage, setReviewedPage] = useState(1);
  const [reviewedError, setReviewedError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminApprovalPackage | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace(APP_ROUTES.login);
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const sequence = ++activeRequest.current;

    async function loadQueue() {
      const { data } = await supabase.auth.getSession();
      const sessionAction = dashboardSessionAction(data.session?.access_token);
      if (sessionAction.type === "redirect") {
        router.replace(APP_ROUTES.login);
        return;
      }

      try {
        const response = await fetchPendingApprovals(fetch, API_URL, sessionAction.accessToken, {
          page,
          perPage,
          sort,
        });
        if (cancelled || !requestSequenceIsCurrent(sequence, activeRequest.current)) return;

        const correctedPage = nextDashboardPage(page, response);
        if (correctedPage !== page) {
          setPage(correctedPage);
          return;
        }

        const needsOldestRequest = page !== 1 || sort !== "submitted_at_asc";
        const oldestRequest = needsOldestRequest
          ? fetchPendingApprovals(fetch, API_URL, sessionAction.accessToken, {
              page: 1,
              perPage: 1,
              sort: "submitted_at_asc",
            }).then((oldestResponse) => oldestResponse.data[0]?.submitted_at ?? null)
          : Promise.resolve(response.data[0]?.submitted_at ?? null);

        setPackages(response.data);
        setMeta(response.meta);
        setUsers([]);
        if (!needsOldestRequest) setOldestSubmittedAt(response.data[0]?.submitted_at ?? null);
        setLoadedAt(new Date().toISOString());
        setStatus(response.data.length ? "ready" : "empty");
        setIsUpdating(false);

        loadQueueEnhancements(
          fetchAdminUsers(fetch, API_URL, sessionAction.accessToken),
          oldestRequest,
          () => !cancelled && requestSequenceIsCurrent(sequence, activeRequest.current),
          setUsers,
          setOldestSubmittedAt,
        );
      } catch (error) {
        if (cancelled || !requestSequenceIsCurrent(sequence, activeRequest.current)) return;
        setIsUpdating(false);
        const failure = dashboardFailure(error);
        if (failure.type === "redirect") {
          router.replace(APP_ROUTES.login);
        } else if (failure.type === "forbidden") {
          setStatus("forbidden");
        } else {
          setErrorMessage(failure.message);
          setStatus("error");
        }
      }
    }

    void loadQueue();
    return () => {
      cancelled = true;
    };
  }, [page, perPage, refreshKey, router, sort]);

  // The reviewed list loads on its own track — a failure there must not take
  // the pending queue down with it.
  useEffect(() => {
    let cancelled = false;
    const sequence = ++reviewedRequest.current;

    async function loadReviewed() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      try {
        const response = await fetchReviewedApprovals(fetch, API_URL, token, {
          page: reviewedPage,
          perPage: DEFAULT_PAGE_SIZE,
        });
        if (cancelled || !requestSequenceIsCurrent(sequence, reviewedRequest.current)) return;
        const corrected = nextDashboardPage(reviewedPage, response);
        if (corrected !== reviewedPage) {
          setReviewedPage(corrected);
          return;
        }
        setReviewedPackages(response.data);
        setReviewedMeta(response.meta);
        setReviewedError("");
      } catch (error) {
        if (cancelled || !requestSequenceIsCurrent(sequence, reviewedRequest.current)) return;
        setReviewedError(error instanceof Error ? error.message : "Unable to load reviewed packages.");
      }
    }

    void loadReviewed();
    return () => {
      cancelled = true;
    };
  }, [reviewedPage, refreshKey]);

  const handleDeleteConfirm = async () => {
    if (!pendingDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new AdminApiError("Your session expired. Please sign in again.", "unauthenticated", 401);
      await deleteAdminPackage(fetch, API_URL, token, pendingDelete.package_id);
      setPendingDelete(null);
      // Refetch the page being viewed — it may have emptied or shifted.
      setReviewedPage((current) => current);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete this package.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace(APP_ROUTES.login);
  };

  return (
    <AdminReviewDashboardView
      status={status}
      packages={packages}
      meta={meta}
      sort={sort}
      perPage={perPage}
      oldestSubmittedAt={oldestSubmittedAt}
      users={users}
      now={loadedAt ?? undefined}
      isUpdating={isUpdating}
      errorMessage={errorMessage}
      reviewedPackages={reviewedPackages}
      reviewedMeta={reviewedMeta}
      reviewedError={reviewedError || undefined}
      pendingDelete={pendingDelete}
      deleteError={deleteError || undefined}
      isDeleting={isDeleting}
      onReviewedPageChange={(nextPage) => setReviewedPage(nextPage)}
      onDeleteRequest={(pkg) => { setDeleteError(""); setPendingDelete(pkg); }}
      onDeleteConfirm={() => { void handleDeleteConfirm(); }}
      onDeleteCancel={() => { if (!isDeleting) setPendingDelete(null); }}
      onSortChange={(nextSort) => {
        setIsUpdating(true);
        setErrorMessage("");
        setPage(1);
        setSort(nextSort);
      }}
      onPerPageChange={(nextPerPage) => {
        setIsUpdating(true);
        setErrorMessage("");
        setPage(1);
        setPerPage(nextPerPage);
      }}
      onPageChange={(nextPage) => {
        setIsUpdating(true);
        setErrorMessage("");
        setPage(nextPage);
      }}
      onRefresh={() => {
        setIsUpdating(true);
        setErrorMessage("");
        setRefreshKey((current) => current + 1);
      }}
      onSignOut={() => { void handleSignOut(); }}
    />
  );
}
