"use client";
import { brand } from "../lib/brand";

import { useEffect, useRef, useState } from "react";
import {
  services,
  serviceRequestSchema,
  type ServiceRequestInput,
} from "@/lib/service-catalog";
import { Field } from "./ui";
import { ServiceArt } from "./service-art";
import { BotCheck, botCheckSiteKey } from "./bot-check";
export function ServiceRequestForm({
  submit,
  publicForm = false,
  projectId = null,
  onReturn,
  returnLabel = "Return to client portal",
}: {
  submit: (input: ServiceRequestInput) => Promise<void>;
  publicForm?: boolean;
  projectId?: string | null;
  onReturn?: () => void;
  returnLabel?: string;
}) {
  const [service, setService] = useState("");
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [serviceAnswers, setServiceAnswers] = useState<
    Record<string, Record<string, string>>
  >({});
  const answers = serviceAnswers[service] || {};
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [attempt, setAttempt] = useState(0);
  const id = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const leave = (destination?: () => void) => {
    if (busy) return;
    const hasDraft =
      !done &&
      [
        ...Object.values(values),
        ...Object.values(serviceAnswers).flatMap(Object.values),
      ].some((value) => value.trim());
    if (
      hasDraft &&
      !window.confirm(
        "Leave this request? Your unsent answers will be discarded.",
      )
    )
      return;
    if (destination) destination();
    else window.location.assign("/");
  };
  const resetRequest = () => {
    setDone(false);
    setStep(0);
    setService("");
    setValues({});
    setServiceAnswers({});
    setError("");
    id.current = "";
    setCaptcha("");
    setAttempt((a) => a + 1);
  };
  const chosen = services.find((s) => s.id === service);
  const update = (key: string, value: string) => {
    if (key.startsWith("answer")) {
      setServiceAnswers((all) => ({
        ...all,
        [service]: { ...all[service], [key]: value },
      }));
    } else setValues((v) => ({ ...v, [key]: value }));
  };
  const input = () => ({
    submission_id: id.current || (id.current = crypto.randomUUID()),
    service,
    title: values.title || "",
    brief: values.brief || "",
    client_name: values.client_name || "",
    email: values.email || "",
    answers: [0, 1, 2].map((i) => answers["answer" + i] || ""),
    budget: values.budget || "Not sure yet",
    desired_date: values.desired_date || "",
    references: values.references || "",
    project_id: projectId,
    website: values.website || "",
    captcha_token: captcha,
  });
  if (done)
    return (
      <section className="request-success" data-no-auto-tooltip>
        <div role="status">
          <div className="eyebrow">NEXT STEP: STUDIO REVIEW</div>
          <h2>Your request is in.</h2>
          <p>
            We’ll review your brief and follow up. Work begins after an
            agreement is approved and the 50% deposit is received.
          </p>
        </div>
        <div className="toolbar">
          <button className="button primary" onClick={() => leave(onReturn)}>
            {returnLabel}
          </button>
          <button className="button" onClick={resetRequest}>
            Request another service
          </button>
        </div>
      </section>
    );
  return (
    <section className="service-request" data-no-auto-tooltip>
      <ol className="request-progress" aria-label="Request progress">
        {["Choose a service", "Tell us about it", "Review & send"].map(
          (s, i) => (
            <li key={s} aria-current={step === i ? "step" : undefined}>
              {i + 1}. {s}
            </li>
          ),
        )}
      </ol>
      {step === 0 ? (
        <>
          <h2 ref={heading} tabIndex={-1}>
            What can we help you with?
          </h2>
          <p>
            Choose the closest fit. You can send another request whenever you
            need.
          </p>
          <div className="service-options">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={service === s.id}
                className={`service-option ${service === s.id ? "selected" : ""}`}
                onClick={() => setService(s.id)}
              >
                <ServiceArt service={s.id} />
                <div className="service-option-copy">
                  <strong>{s.name}</strong>
                  <span>{s.description}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="toolbar request-step-actions request-service-actions">
            <button
              type="button"
              className="button"
              onClick={() => leave(onReturn)}
            >
              {returnLabel}
            </button>
            <button
              className="button primary"
              disabled={!service}
              onClick={() => setStep(1)}
            >
              Continue
            </button>
          </div>
        </>
      ) : (
        <form
          className="settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (step === 1) {
              const parsed = serviceRequestSchema.safeParse(input());
              if (!parsed.success) {
                setError("Please complete the required fields.");
                return;
              }
              setStep(2);
              return;
            }
            setBusy(true);
            try {
              await submit(serviceRequestSchema.parse(input()));
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
              setCaptcha("");
              setAttempt((a) => a + 1);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="service-form-heading">
            {chosen && <ServiceArt service={chosen.id} />}
            <h2 ref={heading} tabIndex={-1}>
              {chosen?.name}
            </h2>
          </div>
          {step === 1 ? (
            <>
              <p>
                Fields marked * are required. “Not sure yet” is a useful answer.
              </p>
              {[
                ["client_name", "Your name / company *"],
                ["email", "Reply email *"],
                ["title", "Give this request a name *"],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    required
                    type={key === "email" ? "email" : "text"}
                    autoComplete={
                      key === "email"
                        ? "email"
                        : key === "client_name"
                          ? "organization"
                          : undefined
                    }
                    maxLength={key === "email" ? 254 : 200}
                    value={values[key] || ""}
                    onChange={(e) => update(key, e.target.value)}
                  />
                </Field>
              ))}
              <Field label="Brief and goals *">
                <textarea
                  required
                  rows={4}
                  maxLength={12000}
                  value={values.brief || ""}
                  onChange={(e) => update("brief", e.target.value)}
                />
              </Field>
              {chosen?.questions.map((q, i) => (
                <Field key={q} label={q + " *"}>
                  <textarea
                    required
                    maxLength={3000}
                    value={answers["answer" + i] || ""}
                    onChange={(e) => update("answer" + i, e.target.value)}
                  />
                </Field>
              ))}
              <Field label="Budget range (optional)">
                <input
                  maxLength={100}
                  placeholder="Not sure yet is fine"
                  value={values.budget || ""}
                  onChange={(e) => update("budget", e.target.value)}
                />
              </Field>
              <Field label="Preferred delivery date (optional)">
                <input
                  type="date"
                  value={values.desired_date || ""}
                  onChange={(e) => update("desired_date", e.target.value)}
                />
              </Field>
              <Field label="Reference links and context (optional)">
                <textarea
                  maxLength={3000}
                  value={values.references || ""}
                  onChange={(e) => update("references", e.target.value)}
                />
              </Field>
              <div hidden aria-hidden="true">
                <input
                  name="website"
                  tabIndex={-1}
                  value={values.website || ""}
                  onChange={(e) => update("website", e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <dl className="request-review">
                {[
                  ["Request", values.title],
                  ["Contact", `${values.client_name} · ${values.email}`],
                  ["Goals", values.brief],
                  ...(chosen?.questions.map((q, i) => [
                    q,
                    answers["answer" + i],
                  ]) || []),
                  ["Budget", values.budget || "Not sure yet"],
                  ["Preferred date", values.desired_date || "Flexible"],
                  ["References", values.references || "None"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Sending this request does not confirm a booking, price, or start
                date. Your details go to {brand.name} for a response.
              </p>
              {publicForm && <BotCheck key={attempt} onToken={setCaptcha} />}
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setStep(step - 1)}
          >
            {step === 2 ? "Edit details" : "Change service"}
          </button>
          <div className="toolbar request-step-actions">
            <button
              type="button"
              aria-label="Cancel request"
              title="Cancel request"
              className="button"
              disabled={busy}
              onClick={() => leave(resetRequest)}
            >
              <span className="request-action-label">Cancel request</span>
            </button>
            <button
              aria-label={
                busy
                  ? "Sending…"
                  : step === 1
                    ? "Review request"
                    : "Send request"
              }
              title={
                busy
                  ? "Sending…"
                  : step === 1
                    ? "Review request"
                    : "Send request"
              }
              className="button primary"
              disabled={
                busy ||
                (step === 2 && publicForm && !!botCheckSiteKey && !captcha)
              }
            >
              <span className="request-action-label">
                {busy
                  ? "Sending…"
                  : step === 1
                    ? "Review request"
                    : "Send request"}
              </span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
