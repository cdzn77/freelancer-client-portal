"use client";
import { brand } from "../lib/brand";

import { useEffect, useState } from "react";
import { ServiceRequestForm } from "./service-request-form";
export function PublicIntake({ token }: { token: string }) {
  const [form, setForm] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/intake/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const x = await r.json();
        if (!r.ok) throw Error(x.error);
        if (active) setForm(x);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <main className="public-intake">
      <div className="eyebrow">{brand.name} · LET’S MAKE SOMETHING</div>
      <h1>{form?.title || "Project & service request"}</h1>
      {form ? (
        <>
          <p>{form.description}</p>
          <ServiceRequestForm
            publicForm
            submit={async (input) => {
              const r = await fetch(
                `/api/intake/${encodeURIComponent(token)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(input),
                },
              );
              const x = await r.json();
              if (!r.ok)
                throw Error(x.error || "Unable to send. Please try again.");
            }}
          />
        </>
      ) : (
        <p role={error ? "alert" : "status"}>
          {error || "Loading request form…"}
        </p>
      )}
    </main>
  );
}
