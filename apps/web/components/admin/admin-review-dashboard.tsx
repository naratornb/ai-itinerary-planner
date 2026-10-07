"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  AdminApiError,
  fetchAdminUsers,
  fetchPendingApprovals,
  type AdminApprovalPackage,
  type AdminUser,
  type ApprovalListResponse,
  type ApprovalSort,
} from "../../lib/admin-api";
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
const PAGE_SIZE = 20;
const EMPTY_META: ApprovalListResponse["meta"] = {
  total: 0,
  page: 1,
  per_page: PAGE_SIZE,
  total_pages: 0,
};

type DashboardStatus = "loading" | "ready" | "empty" | "forbidden" | "error";

export type AdminReviewDashboardViewProps = {
  status: DashboardStatus;
  packages: AdminApprovalPackage[];
  meta: ApprovalListResponse["meta"];
  sort: ApprovalSort;
  oldestSubmittedAt: string | null;
  users: AdminUser[];
  now?: Date | string;
  isUpdating: boolean;
  errorMessage?: string;
  onSortChange: (sort: ApprovalSort) => void;
  onPageChange: (page: number) => void;
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

function SummaryCards({
  total,
  oldestSubmittedAt,
  now,
}: {
  total: number;
  oldestSubmittedAt: string | null;
  now?: Date | string;
}) {
  return (
    <section className="admin-review-summary" aria-label="Review queue summary">
      <article className="admin-review-summary__card">
        <span>Pending review</span>
        <strong>{total}</strong>
        <p>Packages currently waiting for an administrator.</p>
      </article>
      <article className="admin-review-summary__card">
        <span>Oldest waiting</span>
        <strong>{formatWaitingAge(oldestSubmittedAt, now)}</strong>
        <p>Time since the earliest available submission.</p>
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
            <th scope="col">Duration</th>
            <th scope="col">Price</th>
            <th scope="col"><span className="admin-review-sr-only">Action</span></th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
            <tr key={pkg.package_id}>
              <td><strong>{pkg.title}</strong></td>
              <td>{formatAdminDestination(pkg)}</td>
              <td>{creatorLabel(pkg.creator_id, users)}</td>
              <td className="admin-review-submitted"><PackageMeta pkg={pkg} now={now} /></td>
              <td>{formatAdminDuration(pkg.duration_days)}</td>
              <td className="admin-review-price">{formatAdminPrice(pkg.base_price_aud)}</td>
              <td className="admin-review-action-cell">
                <Link
                  className="admin-review-link"
                  href={adminApprovalRoute(pkg.package_id)}
                  aria-label={`Review ${pkg.title}`}
                >
                  Review
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
            <Link
              className="admin-review-link"
              href={adminApprovalRoute(pkg.package_id)}
              aria-label={`Review ${pkg.title}`}
            >
              Review
            </Link>
          </div>
          <dl>
            <div><dt>Destination</dt><dd>{formatAdminDestination(pkg)}</dd></div>
            <div><dt>Creator</dt><dd>{creatorLabel(pkg.creator_id, users)}</dd></div>
            <div><dt>Submitted</dt><dd className="admin-review-submitted"><PackageMeta pkg={pkg} now={now} /></dd></div>
            <div><dt>Duration</dt><dd>{formatAdminDuration(pkg.duration_days)}</dd></div>
            <div><dt>Price</dt><dd className="admin-review-price">{formatAdminPrice(pkg.base_price_aud)}</dd></div>
          </dl>
        </article>
      ))}
    </section>
  );
}

function LoadingState() {
  return (
    <div className="admin-review-loading" aria-busy="true" aria-label="Loading review queue">
      <section className="admin-review-summary" aria-hidden="true">
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
    packages,
    meta,
    sort,
    oldestSubmittedAt,
    users,
    now,
    isUpdating,
    errorMessage,
    onSortChange,
    onPageChange,
    onRefresh,
    onSignOut,
  } = props;

  return (
    <div className="admin-review-page">
      <header className="admin-review-header">
        <Link href={APP_ROUTES.marketplace} className="admin-review-brand">Travel Marketplace</Link>
        <span className="admin-review-context">Admin workspace</span>
        <button type="button" onClick={onSignOut}>Sign out</button>
      </header>

      <main className="admin-review-shell">
        <div className="admin-review-intro">
          <h1>Review dashboard</h1>
          <p>Open the oldest submissions first, or change the order when another package needs attention.</p>
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
            <SummaryCards total={meta.total} oldestSubmittedAt={oldestSubmittedAt} now={now} />

            {status === "empty" ? (
              <StatePanel title="All caught up" role="status">
                <p>There are no packages waiting for review right now.</p>
                <button className="admin-review-secondary-button" type="button" onClick={onRefresh}>Refresh queue</button>
              </StatePanel>
            ) : (
              <section
                className="admin-review-queue"
                aria-labelledby="admin-review-queue-title"
                aria-busy={isUpdating}
              >
                <div className="admin-review-controls">
                  <div>
                    <h2 id="admin-review-queue-title">Packages waiting for review</h2>
                    <p aria-live="polite">{approvalResultRange(meta, packages.length)}</p>
                  </div>
                  <div className="admin-review-control-actions">
                    <label>
                      <span>Sort queue</span>
                      <select
                        value={sort}
                        onChange={(event) => onSortChange(event.target.value as ApprovalSort)}
                      >
                        <option value="submitted_at_asc">Oldest first</option>
                        <option value="submitted_at_desc">Newest first</option>
                      </select>
                    </label>
                    <button className="admin-review-secondary-button" type="button" onClick={onRefresh}>Refresh</button>
                  </div>
                </div>

                <QueueTable packages={packages} users={users} now={now} />
                <QueueCards packages={packages} users={users} now={now} />

                <nav className="admin-review-pagination" aria-label="Review queue pagination">
                  <span>Page {meta.page} of {Math.max(1, meta.total_pages)}</span>
                  <div>
                    <button
                      className="admin-review-secondary-button"
                      type="button"
                      disabled={meta.page <= 1}
                      onClick={() => onPageChange(meta.page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="admin-review-secondary-button"
                      type="button"
                      disabled={meta.page >= meta.total_pages}
                      onClick={() => onPageChange(meta.page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </nav>
              </section>
            )}
          </>
        ) : null}
      </main>
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
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

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
          perPage: PAGE_SIZE,
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
  }, [page, refreshKey, router, sort]);

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
      oldestSubmittedAt={oldestSubmittedAt}
      users={users}
      now={loadedAt ?? undefined}
      isUpdating={isUpdating}
      errorMessage={errorMessage}
      onSortChange={(nextSort) => {
        setIsUpdating(true);
        setErrorMessage("");
        setPage(1);
        setSort(nextSort);
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
