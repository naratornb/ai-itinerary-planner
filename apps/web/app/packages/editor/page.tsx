"use client";

import { useRouter } from "next/navigation";

import ItineraryEditor from "../../../components/itinerary-editor";
import { useDemoState } from "../../../components/demo-state";
import { APP_ROUTES } from "../../../lib/routes";

export default function PackageEditorPage() {
  const router = useRouter();
  const { setWizardStep } = useDemoState();

  return <ItineraryEditor onBack={() => {
    setWizardStep(3);
    router.push(APP_ROUTES.wizard);
  }} />;
}
