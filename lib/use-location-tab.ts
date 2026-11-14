"use client";
import { useState, useEffect } from "react";
/** Store only navigation labels, never form values or credentials. */
export function useLocationTab(
  key: string,
  fallback: string,
  allowed: readonly string[],
) {
  const read = () => {
    if (typeof window === "undefined") return fallback;
    const value = new URLSearchParams(window.location.search).get(key);
    return value && allowed.includes(value) ? value : fallback;
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const restore = () => setValue(read());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [key, fallback, allowed.join("|")]);
  function select(next: string) {
    if (!allowed.includes(next)) return;
    setValue(next);
    const url = new URL(window.location.href);
    url.searchParams.set(key, next);
    if (url.href !== window.location.href)
      window.history.pushState(window.history.state, "", url);
  }
  return [value, select] as const;
}
