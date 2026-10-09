"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
  AdminApiError,
  approveAdminPackage,
  rejectAdminPackage,
  type AdminApprovalRecord,
  type AdminPackageDetail,
} from "../../lib/admin-api";
import { loadAdminPackageForReview } from "../../lib/admin-package-supabase";
import { STATUS_LABELS } from "../../lib/creator-api";
import {
  formatAdminDestination,
  formatAdminDuration,
  formatSubmittedAt,
  reviewPhotos,
  safeImageSrc,
  type ReviewPhoto,
} from "../../lib/admin-review";
import { buildDaysFromPackage, type BuilderDay, type DayPhoto, type TimelineItem } from "../../lib/itinerary-builder";
import { APP_ROUTES } from "../../lib/routes";
import { supabase } from "../../lib/supabase/client";
import Icon from "../icon";
import { creatorPackageStatusStyle } from "../migrated-screens";
import { AdminHeader } from "./admin-header";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type DetailStatus = "loading" | "ready" | "not-found" | "forbidden" | "conflict" | "error";
type DecisionDialog = "approve" | "reject" | "success" | null;
type DecisionResult = "approved" | "changes-requested" | null;

export type AdminReviewDetailViewProps = {
  status: DetailStatus;
  packageDetail: AdminPackageDetail | null;
  selectedDay: number;
  dialog: DecisionDialog;
  decisionResult?: DecisionResult;
  notes: string;
  rejectionReason: string;
  isSubmitting: boolean;
  errorMessage?: string;
  decisionError?: string;
  onSelectDay: (day: number) => void;
  onOpenApprove: () => void;
  onOpenReject: () => void;
  onCloseDialog: () => void;
  onNotesChange: (notes: string) => void;
  onRejectionReasonChange: (reason: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
  onSignOut: () => void;
};

// Shown when the package is no longer pending: either an admin opened a decided
// package from the Reviewed list, or another admin decided it first.
export function decisionNotice(status: string | undefined, fallback?: string): { title: string; message: string } {
  if (status === "approved") return { title: "Already approved", message: "This package has been approved and can be published by its creator." };
  if (status === "rejected") return { title: "Changes already requested", message: "This package was returned to its creator for changes." };
  if (status === "live") return { title: "Already live", message: "This package is published in the marketplace." };
  return { title: "No longer pending review", message: fallback || "This package is no longer pending review." };
}

export function rejectionReasonError(reason: string): string {
  return reason.trim().length < 10 ? "Enter at least 10 characters." : "";
}

export function detailFailure(error: unknown): { status: DetailStatus; message: string } {
  const candidate = error && typeof error === "object"
    ? error as { status?: unknown; message?: unknown }
    : {};
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  const message = typeof candidate.message === "string" && candidate.message.trim()
    ? candidate.message
    : "Unable to load this package for review.";
  if (status === 403) return { status: "forbidden", message };
  if (status === 404) return { status: "not-found", message };
  if (status === 409) return { status: "conflict", message };
  return { status: "error", message };
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDayDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function creatorName(pkg: AdminPackageDetail): string {
  return pkg.creator?.full_name?.trim() || `Creator ${pkg.creator_id.slice(0, 8)}`;
}

function StatePanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <section className="admin-detail-state" role="alert">
      <h1>{title}</h1>
      <p>{message}</p>
      {action}
    </section>
  );
}

function LoadingState() {
  return (
    <main className="admin-detail-shell" aria-busy="true" aria-label="Loading package review">
      <div className="admin-detail-skeleton admin-detail-skeleton--heading" />
      <div className="admin-detail-layout">
        <div className="admin-detail-skeleton admin-detail-skeleton--content" />
        <div className="admin-detail-skeleton admin-detail-skeleton--aside" />
      </div>
      <span className="admin-review-sr-only">Loading package review.</span>
    </main>
  );
}

function ReviewIntro({ pkg }: { pkg: AdminPackageDetail }) {
  return (
    <section className="admin-detail-intro">
      <Link className="admin-detail-back" href={APP_ROUTES.admin}>
        <span aria-hidden="true">←</span> Back to review dashboard
      </Link>
      <div className="admin-detail-title-row">
        <div>
          <h1>{pkg.title}</h1>
          <p>{formatAdminDestination(pkg)} · by {creatorName(pkg)}</p>
        </div>
        <span className="admin-detail-status" style={creatorPackageStatusStyle(pkg.status)}>
          {pkg.status === "pending_review" ? "Pending review" : STATUS_LABELS[pkg.status] ?? pkg.status}
        </span>
      </div>
      <p className="admin-detail-submitted">Submitted {formatSubmittedAt(pkg.submitted_at ?? null)}</p>
    </section>
  );
}

function Cover({ pkg }: { pkg: AdminPackageDetail }) {
  return (
    <section className="admin-detail-cover" aria-labelledby="admin-detail-overview-title">
      <div className="admin-detail-cover__media">
        {safeImageSrc(pkg.cover_image_url) ? (
          // The API owns this URL and may return any configured storage host.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={safeImageSrc(pkg.cover_image_url)} alt={`Cover for ${pkg.title}`} />
        ) : (
          <div className="admin-detail-cover__placeholder">
            <Icon name="pin" size={24} />
            <span>Cover image not provided</span>
          </div>
        )}
      </div>
      <div className="admin-detail-cover__copy">
        <h2 id="admin-detail-overview-title">Package overview</h2>
        <p>{pkg.description?.trim() || "No package description was provided."}</p>
        <dl className="admin-detail-facts">
          <div><dt>Destination</dt><dd>{formatAdminDestination(pkg)}</dd></div>
          <div><dt>Duration</dt><dd>{formatAdminDuration(pkg.duration_days)}</dd></div>
          <div><dt>Group size</dt><dd>{pkg.max_group_size ? `Up to ${pkg.max_group_size}` : "Not provided"}</dd></div>
          <div><dt>Season</dt><dd>{pkg.season || "Not provided"}</dd></div>
        </dl>
        {pkg.tags?.length ? (
          <ul className="admin-detail-tags" aria-label="Package tags">
            {pkg.tags.map((tag) => <li key={tag}>{tag}</li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

// Reviewers approve what travellers will see, so every uploaded image is shown
// here and opens full size in a new tab. An unusable address is flagged instead
// of silently dropped.
function PhotoLink({ src, alt, label, className }: { src: string; alt: string; label: string; className?: string }) {
  const safe = safeImageSrc(src);
  if (!safe) {
    return <span className={`admin-detail-photo__invalid ${className ?? ""}`}>Invalid image address</span>;
  }
  return (
    <a className={`admin-detail-photo__link ${className ?? ""}`} href={safe} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {/* Storage hosts vary per environment, so next/image is not configured for them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={safe} alt={alt} loading="lazy" />
    </a>
  );
}

function PhotoStrip({ photos, label }: { photos: DayPhoto[]; label: string }) {
  if (!photos.length) return null;
  return (
    <ul className="admin-detail-photo-strip" aria-label={label}>
      {photos.map((photo, index) => (
        <li key={`${photo.media_id ?? photo.src}-${index}`}>
          <PhotoLink src={photo.src} alt={photo.alt} label={`Open ${photo.alt || "photo"} in a new tab`} />
        </li>
      ))}
    </ul>
  );
}

function PhotoReview({ photos }: { photos: ReviewPhoto[] }) {
  const unplaced = photos.filter((photo) => !photo.placements.length).length;
  return (
    <section className="admin-detail-photos" aria-labelledby="admin-detail-photos-title">
      <div className="admin-detail-section-heading">
        <div>
          <h2 id="admin-detail-photos-title">Photos <span className="admin-detail-photos__count">{photos.length}</span></h2>
          <p>Check every image the creator uploaded before approving. Select a photo to open it full size.</p>
        </div>
      </div>
      {photos.length ? (
        <>
          {unplaced ? (
            <p className="admin-detail-photos__note" role="status">
              {unplaced} {unplaced === 1 ? "photo is" : "photos are"} not placed on a day or stop.
            </p>
          ) : null}
          <ul className="admin-detail-photo-grid">
            {photos.map((photo, index) => (
              <li key={photo.mediaId || index}>
                <figure>
                  <PhotoLink
                    src={photo.src}
                    alt={photo.caption || `Package photo ${index + 1}`}
                    label={`Open photo ${index + 1} in a new tab`}
                  />
                  <figcaption>
                    <span className="admin-detail-photo__badges">
                      {photo.isCover ? <b>Cover</b> : null}
                      {photo.placements.length ? null : <b className="admin-detail-photo__warn">Not placed</b>}
                    </span>
                    {photo.caption ? <span>{photo.caption}</span> : null}
                    {photo.placements.length ? <small>{photo.placements.join(", ")}</small> : null}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="admin-detail-empty-day">No photos were uploaded for this package.</p>
      )}
    </section>
  );
}

function itemMeta(item: TimelineItem): string[] {
  if (item.type === "FLIGHT") {
    return [item.subtitle, item.flightNumber, item.cabinClass].filter((value): value is string => Boolean(value));
  }
  if (item.type === "HOTEL") {
    return [item.roomType, item.address].filter((value): value is string => Boolean(value));
  }
  return [item.category, item.duration ? `${item.duration} min` : undefined, item.address]
    .filter((value): value is string => Boolean(value));
}

function ItineraryItem({ item }: { item: TimelineItem }) {
  const metadata = itemMeta(item);
  return (
    <li className="admin-detail-item">
      <div className="admin-detail-item__time">
        <Icon name={item.icon} size={18} />
        <span>{item.time || "Time not set"}</span>
      </div>
      <div className="admin-detail-item__body">
        <span className="admin-detail-item__type">{item.type}</span>
        <h4>{item.title}</h4>
        {metadata.length ? <p>{metadata.join(" · ")}</p> : null}
        {item.notes ? <p className="admin-detail-item__notes">{item.notes}</p> : null}
        <PhotoStrip photos={item.photos ?? []} label={`Photos for ${item.title}`} />
      </div>
      <strong className="admin-detail-item__price">{item.price}</strong>
    </li>
  );
}

function Itinerary({
  days,
  selectedDay,
  onSelectDay,
}: {
  days: BuilderDay[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
}) {
  const activeDay = days.find((day) => day.day === selectedDay) ?? days[0];
  return (
    <section className="admin-detail-itinerary" aria-labelledby="admin-detail-itinerary-title">
      <div className="admin-detail-section-heading">
        <div>
          <h2 id="admin-detail-itinerary-title">Itinerary</h2>
          <p>Review the submitted sequence, timings, and component prices.</p>
        </div>
      </div>
      <div className="admin-detail-day-tabs" role="tablist" aria-label="Itinerary days">
        {days.map((day) => (
          <button
            type="button"
            role="tab"
            aria-selected={day.day === activeDay?.day}
            key={day.id}
            onClick={() => onSelectDay(day.day)}
          >
            <span>Day {day.day}</span>
            <small>{day.title}</small>
          </button>
        ))}
      </div>
      {activeDay ? (
        <article className="admin-detail-day" role="tabpanel">
          <div className="admin-detail-day__heading">
            <div>
              <span>Day {activeDay.day}{formatDayDate(activeDay.date) ? ` · ${formatDayDate(activeDay.date)}` : ""}</span>
              <h3>{activeDay.title}</h3>
            </div>
            <strong>{activeDay.items.length} {activeDay.items.length === 1 ? "item" : "items"}</strong>
          </div>
          {activeDay.story ? <p className="admin-detail-day__story">{activeDay.story}</p> : null}
          <PhotoStrip photos={activeDay.photos ?? []} label={`Photos for day ${activeDay.day}`} />
          {activeDay.items.length ? (
            <ol className="admin-detail-items">
              {activeDay.items.map((item) => <ItineraryItem item={item} key={`${activeDay.id}-${item.id}`} />)}
            </ol>
          ) : (
            <p className="admin-detail-empty-day">No itinerary items were submitted for this day.</p>
          )}
        </article>
      ) : (
        <p className="admin-detail-empty-day">No itinerary days were submitted.</p>
      )}
    </section>
  );
}

function Pricing({ pkg }: { pkg: AdminPackageDetail }) {
  const pricing = pkg.pricing;
  return (
    <section className="admin-detail-pricing" aria-labelledby="admin-detail-pricing-title">
      <h2 id="admin-detail-pricing-title">Price breakdown</h2>
      {pricing ? (
        <dl>
          <div><dt>Flights</dt><dd>{formatCurrency(pricing.flights_total)}</dd></div>
          <div><dt>Stays</dt><dd>{formatCurrency(pricing.hotels_total)}</dd></div>
          <div><dt>Activities</dt><dd>{formatCurrency(pricing.activities_total)}</dd></div>
          <div className="admin-detail-pricing__components"><dt>Components total</dt><dd>{formatCurrency(pricing.components_total)}</dd></div>
          <div className="admin-detail-pricing__total"><dt>Package price</dt><dd>{formatCurrency(pricing.base_price_aud)}</dd></div>
        </dl>
      ) : (
        <dl>
          <div className="admin-detail-pricing__total"><dt>Package price</dt><dd>{formatCurrency(pkg.base_price_aud)}</dd></div>
        </dl>
      )}
      <p>Prices are shown in AUD from the submitted package data.</p>
    </section>
  );
}

function LastDecision({ approval, pending }: { approval: AdminApprovalRecord; pending: boolean }) {
  const approved = approval.decision === "approved";
  return (
    <section className="admin-detail-last-decision" aria-label="Previous decision">
      <h3>{pending ? "Previous decision" : "Last decision"}</h3>
      <p className="admin-detail-last-decision__meta">
        <strong>{approved ? "Approved" : "Changes requested"}</strong>
        <span>{formatSubmittedAt(approval.reviewed_at ?? null)}</span>
      </p>
      {approval.rejection_reason ? <p><b>Reason sent to creator</b>{approval.rejection_reason}</p> : null}
      {approval.notes ? <p><b>Internal notes</b>{approval.notes}</p> : null}
    </section>
  );
}

function DecisionPanel({
  pkg,
  onOpenApprove,
  onOpenReject,
}: {
  pkg: AdminPackageDetail;
  onOpenApprove: () => void;
  onOpenReject: () => void;
}) {
  const canDecide = pkg.status === "pending_review";
  return (
    <aside className="admin-detail-sidebar" aria-label="Review decision">
      <Pricing pkg={pkg} />
      <section className="admin-detail-decision">
        <h2>Review decision</h2>
        <p>Approve this package or return it to the creator with a clear reason.</p>
        <button
          className="admin-review-primary-button"
          type="button"
          disabled={!canDecide}
          onClick={onOpenApprove}
        >
          Approve package
        </button>
        <button
          className="admin-detail-request-button"
          type="button"
          disabled={!canDecide}
          onClick={onOpenReject}
        >
          Request changes
        </button>
        {!canDecide ? <p className="admin-detail-decision__notice">This package is no longer pending review.</p> : null}
      </section>
      {pkg.latest_approval ? <LastDecision approval={pkg.latest_approval} pending={canDecide} /> : null}
    </aside>
  );
}

function DecisionModal(props: Pick<
  AdminReviewDetailViewProps,
  | "dialog"
  | "decisionResult"
  | "notes"
  | "rejectionReason"
  | "isSubmitting"
  | "decisionError"
  | "onCloseDialog"
  | "onNotesChange"
  | "onRejectionReasonChange"
  | "onApprove"
  | "onReject"
>) {
  if (!props.dialog) return null;
  if (props.dialog === "success") {
    return (
      <div className="admin-detail-dialog-backdrop">
        <dialog className="admin-detail-dialog admin-detail-dialog--success" open role="dialog" aria-modal="true" aria-labelledby="admin-detail-dialog-title">
          <span className="admin-detail-success-icon"><Icon name="check" size={28} /></span>
          <h2 id="admin-detail-dialog-title">
            {props.decisionResult === "approved" ? "Package approved" : "Change request sent"}
          </h2>
          <p>
            {props.decisionResult === "approved"
              ? "The package is approved and can now be published by its creator."
              : "The package was returned to its creator with your feedback."}
          </p>
          <button className="admin-review-primary-button" type="button" onClick={props.onCloseDialog}>Back to dashboard</button>
        </dialog>
      </div>
    );
  }

  const rejecting = props.dialog === "reject";
  const reasonError = rejecting ? rejectionReasonError(props.rejectionReason) : "";
  return (
    <div className="admin-detail-dialog-backdrop">
      <dialog className="admin-detail-dialog" open role="dialog" aria-modal="true" aria-labelledby="admin-detail-dialog-title">
        <h2 id="admin-detail-dialog-title">{rejecting ? "Request package changes" : "Confirm approval"}</h2>
        <p>
          {rejecting
            ? "Explain what the creator needs to update before submitting again."
            : "Approve this package based on the submitted itinerary and pricing."}
        </p>
        {rejecting ? (
          <label>
            <span>Reason for the creator</span>
            <textarea
              value={props.rejectionReason}
              onChange={(event) => props.onRejectionReasonChange(event.target.value)}
              rows={4}
              aria-describedby="admin-detail-reason-help"
            />
            <small id="admin-detail-reason-help">{reasonError || "This feedback is shown to the creator."}</small>
          </label>
        ) : null}
        <label>
          <span>Internal notes <small>(optional)</small></span>
          <textarea
            value={props.notes}
            onChange={(event) => props.onNotesChange(event.target.value)}
            rows={3}
          />
        </label>
        {props.decisionError ? <p className="admin-detail-dialog__error" role="alert">{props.decisionError}</p> : null}
        <div className="admin-detail-dialog__actions">
          <button className="admin-review-secondary-button" type="button" disabled={props.isSubmitting} onClick={props.onCloseDialog}>Cancel</button>
          <button
            className={rejecting ? "admin-detail-request-button" : "admin-review-primary-button"}
            type="button"
            disabled={props.isSubmitting || Boolean(reasonError)}
            onClick={rejecting ? props.onReject : props.onApprove}
          >
            {props.isSubmitting ? "Saving…" : rejecting ? "Send change request" : "Approve package"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

export function AdminReviewDetailView(props: AdminReviewDetailViewProps): ReactNode {
  if (props.status === "loading") {
    return <div className="admin-review-page"><AdminHeader onSignOut={props.onSignOut} /><LoadingState /></div>;
  }

  if (!props.packageDetail || props.status === "not-found" || props.status === "forbidden" || props.status === "error") {
    const state = props.status === "not-found"
      ? { title: "Package not found", message: props.errorMessage || "This package may have been removed." }
      : props.status === "forbidden"
        ? { title: "Administrator access required", message: props.errorMessage || "This account cannot review packages." }
        : { title: "This package could not be loaded", message: props.errorMessage || "Please check the connection and try again." };
    return (
      <div className="admin-review-page">
        <AdminHeader onSignOut={props.onSignOut} />
        <main className="admin-detail-shell">
          <Link className="admin-detail-back" href={APP_ROUTES.admin}>← Back to review dashboard</Link>
          <StatePanel
            title={state.title}
            message={state.message}
            action={props.status === "error"
              ? <button className="admin-review-primary-button" type="button" onClick={props.onRetry}>Try again</button>
              : null}
          />
        </main>
      </div>
    );
  }

  const days = buildDaysFromPackage(props.packageDetail);
  return (
    <div className="admin-review-page">
      <AdminHeader onSignOut={props.onSignOut} />
      <main className="admin-detail-shell">
        <ReviewIntro pkg={props.packageDetail} />
        {props.status === "conflict" ? (
          <div className="admin-detail-conflict" role="status">
            <strong>{decisionNotice(props.packageDetail.status, props.errorMessage).title}</strong>
            <span>{decisionNotice(props.packageDetail.status, props.errorMessage).message}</span>
          </div>
        ) : null}
        <div className="admin-detail-layout">
          <div className="admin-detail-main">
            <Cover pkg={props.packageDetail} />
            <PhotoReview photos={reviewPhotos(props.packageDetail, days)} />
            <Itinerary days={days} selectedDay={props.selectedDay} onSelectDay={props.onSelectDay} />
          </div>
          <DecisionPanel pkg={props.packageDetail} onOpenApprove={props.onOpenApprove} onOpenReject={props.onOpenReject} />
        </div>
      </main>
      <DecisionModal {...props} />
    </div>
  );
}

export default function AdminReviewDetail({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [packageDetail, setPackageDetail] = useState<AdminPackageDetail | null>(null);
  const [selectedDay, setSelectedDay] = useState(1);
  const [dialog, setDialog] = useState<DecisionDialog>(null);
  const [decisionResult, setDecisionResult] = useState<DecisionResult>(null);
  const [notes, setNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace(APP_ROUTES.login);
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function loadPackage() {
      setStatus("loading");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace(APP_ROUTES.login);
        return;
      }
      try {
        const detail = await loadAdminPackageForReview(
          fetch,
          supabase,
          API_URL,
          token,
          packageId,
        );
        if (cancelled) return;
        setPackageDetail(detail);
        setSelectedDay(1);
        setErrorMessage("");
        if (detail.status && detail.status !== "pending_review") {
          setStatus("conflict");
          setErrorMessage("This package is no longer pending review.");
        } else {
          setStatus("ready");
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof AdminApiError && error.kind === "unauthenticated") {
          router.replace(APP_ROUTES.login);
          return;
        }
        const failure = detailFailure(error);
        setErrorMessage(failure.message);
        setStatus(failure.status);
      }
    }
    void loadPackage();
    return () => { cancelled = true; };
  }, [packageId, retryKey, router]);

  const submitDecision = async (decision: "approve" | "reject") => {
    if (!packageDetail || isSubmitting) return;
    if (decision === "reject" && rejectionReasonError(rejectionReason)) return;
    setIsSubmitting(true);
    setDecisionError("");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace(APP_ROUTES.login);
      return;
    }
    try {
      const result = decision === "approve"
        ? await approveAdminPackage(fetch, API_URL, token, packageId, notes)
        : await rejectAdminPackage(fetch, API_URL, token, packageId, rejectionReason, notes);
      setPackageDetail({ ...packageDetail, status: result.package.status });
      setDecisionResult(decision === "approve" ? "approved" : "changes-requested");
      setDialog("success");
    } catch (error) {
      if (error instanceof AdminApiError && error.kind === "unauthenticated") {
        router.replace(APP_ROUTES.login);
        return;
      }
      if (error instanceof AdminApiError && error.status === 409) {
        // Another admin decided first — reload so the page (and its buttons)
        // reflect the package's real status instead of staying actionable.
        setDialog(null);
        setRetryKey((current) => current + 1);
      } else {
        setDecisionError(error instanceof Error ? error.message : "Unable to save this decision.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseDialog = () => {
    if (dialog === "success") {
      router.push(APP_ROUTES.admin);
      return;
    }
    setDialog(null);
    setDecisionError("");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace(APP_ROUTES.login);
  };

  return (
    <AdminReviewDetailView
      status={status}
      packageDetail={packageDetail}
      selectedDay={selectedDay}
      dialog={dialog}
      decisionResult={decisionResult}
      notes={notes}
      rejectionReason={rejectionReason}
      isSubmitting={isSubmitting}
      errorMessage={errorMessage}
      decisionError={decisionError}
      onSelectDay={setSelectedDay}
      onOpenApprove={() => { setDecisionError(""); setDialog("approve"); }}
      onOpenReject={() => { setDecisionError(""); setDialog("reject"); }}
      onCloseDialog={handleCloseDialog}
      onNotesChange={setNotes}
      onRejectionReasonChange={setRejectionReason}
      onApprove={() => { void submitDecision("approve"); }}
      onReject={() => { void submitDecision("reject"); }}
      onRetry={() => setRetryKey((current) => current + 1)}
      onSignOut={() => { void handleSignOut(); }}
    />
  );
}
