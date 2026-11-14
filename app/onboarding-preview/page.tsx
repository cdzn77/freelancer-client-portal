import { notFound } from "next/navigation";
import { OnboardingPreview } from "@/components/onboarding-preview";
export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <OnboardingPreview />;
}
