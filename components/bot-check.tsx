"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
export const botCheckSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
export function BotCheck({ onToken }: { onToken: (token: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!loaded || !container.current || !window.turnstile) return;
    const api = window.turnstile;
    const widget = api.render(container.current, {
      sitekey: botCheckSiteKey,
      theme: "light",
      callback: (token: string) => {
        setError("");
        callback.current(token);
      },
      "expired-callback": () => callback.current(""),
      "error-callback": () => {
        callback.current("");
        setError(
          "Bot verification could not finish. Reload this page to try again.",
        );
      },
    });
    return () => {
      api.remove(widget);
      callback.current("");
    };
  }, [loaded]);
  if (!botCheckSiteKey) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setLoaded(true)}
        onError={() =>
          setError(
            "Could not load bot verification. Check your connection and reload.",
          )
        }
      />
      <div ref={container} aria-label="Bot verification" />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
