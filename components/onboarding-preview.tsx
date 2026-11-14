"use client";
import { ServiceRequestForm } from "./service-request-form";
export function OnboardingPreview() {
  return (
    <main className="public-intake">
      <div className="eyebrow">LOCAL PREVIEW · NOTHING IS SENT</div>
      <h1>Let’s make something.</h1>
      <p>Tell us about the work you have in mind.</p>
      <ServiceRequestForm submit={async () => {}} />
    </main>
  );
}
