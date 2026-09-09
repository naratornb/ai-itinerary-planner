/**
 * app/api/ai/copilot/[sessionId]/route.ts
 * ========================================
 * Mock session-end endpoint — see ../route.ts for context. The real backend
 * will free server-side session state here; the mock has none to free.
 */

import { NextResponse } from "next/server";

export async function DELETE() {
  return new NextResponse(null, { status: 204 });
}
