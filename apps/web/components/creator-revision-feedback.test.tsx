import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import CreatorRevisionFeedback from "./creator-revision-feedback";

test("shows the administrator's reason for a rejected package", () => {
  const html = renderToStaticMarkup(
    <CreatorRevisionFeedback
      status="rejected"
      approval={{
        decision: "rejected",
        rejection_reason: "Please clarify which transfers are included.",
        reviewed_at: "2026-10-07T04:22:00Z",
      }}
    />,
  );

  assert.match(html, /Changes requested/);
  assert.match(html, /Please clarify which transfers are included\./);
  assert.match(html, /Reviewed/);
  assert.match(html, /dateTime="2026-10-07T04:22:00Z"/);
});

test("does not show revision feedback outside the rejected state", () => {
  const html = renderToStaticMarkup(
    <CreatorRevisionFeedback
      status="approved"
      approval={{
        decision: "rejected",
        rejection_reason: "Old feedback",
        reviewed_at: "2026-10-07T04:22:00Z",
      }}
    />,
  );

  assert.equal(html, "");
});

test("shows a clear fallback when a rejected package has no approval data", () => {
  const html = renderToStaticMarkup(
    <CreatorRevisionFeedback
      status="rejected"
      approval={null}
    />,
  );

  assert.match(html, /Changes requested/);
  assert.match(html, /No feedback was provided by the reviewer\./);
  assert.doesNotMatch(html, /Reviewed/);
});
