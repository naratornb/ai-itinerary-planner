import { redirect } from "next/navigation";

// The AI wizard doesn't create a real package yet (see BuilderScreen for the
// "Build from Scratch" path, which does), so this route has no package id of
// its own. Redirect to the seeded demo package's editor route so there is
// only one implementation (/packages/editor/[packageId]) instead of two
// separate pages that both wrap PackageEditorScreen.
const DEMO_PACKAGE_ID = "b0000000-0000-0000-0000-000000000001";

export default function PackageEditorPage() {
  redirect(`/packages/editor/${DEMO_PACKAGE_ID}`);
}
