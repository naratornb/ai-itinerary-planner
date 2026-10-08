import type { CreatorApprovalRecord } from "../lib/creator-api";
import Icon from "./icon";

function reviewedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(date);
}

export default function CreatorRevisionFeedback({
  status,
  approval,
}: {
  status: string;
  approval?: CreatorApprovalRecord | null;
}) {
  if (status !== "rejected") return null;

  const rejectedApproval = approval?.decision === "rejected" ? approval : null;
  const reason = rejectedApproval?.rejection_reason?.trim()
    || "No feedback was provided by the reviewer.";

  const reviewed = reviewedDate(rejectedApproval?.reviewed_at);

  return (
    <section className="creator-revision-feedback" aria-labelledby="creator-revision-feedback-title">
      <div className="creator-revision-feedback__inner">
        <span className="creator-revision-feedback__icon" aria-hidden="true">
          <Icon name="alert" size={20} />
        </span>
        <div>
          <h2 id="creator-revision-feedback-title">Changes requested</h2>
          <p>{reason}</p>
          {reviewed && rejectedApproval?.reviewed_at ? (
            <time dateTime={rejectedApproval.reviewed_at}>Reviewed {reviewed}</time>
          ) : null}
        </div>
      </div>
    </section>
  );
}
