"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
export const AvatarContext = createContext<{
  urls: Record<string, string>;
  refresh: () => Promise<void>;
}>({ urls: {}, refresh: async () => {} });
export const useAvatars = () => useContext(AvatarContext);
export function AvatarProvider({
  userIds,
  children,
}: {
  userIds: string[];
  children: ReactNode;
}) {
  const ids = [...new Set(userIds)].sort().join(",");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    const users = ids.split(",").filter(Boolean);
    if (!users.length) {
      setUrls({});
      return;
    }
    const next: Record<string, string> = {};
    // Batch large workspaces without requesting unrelated users' photos.
    for (let i = 0; i < users.length; i += 100) {
      const batch = users.slice(i, i + 100);
      const { data } = await supabase.storage
        .from("profile-photos")
        .createSignedUrls(
          batch.map((id) => `${id}/avatar.jpg`),
          3600,
        );
      for (const item of data || [])
        if (item.signedUrl && !item.error && item.path) {
          next[item.path.split("/")[0]] = `${item.signedUrl}&v=${Date.now()}`;
        }
    }
    if (sequence.current === current) setUrls(next);
  }, [ids]);
  useEffect(() => {
    setUrls({});
    // Network errors must not interrupt the workspace; initials remain available.
    const reload = () => void refresh().catch(() => {});
    reload();
    const timer = setInterval(reload, 45 * 60 * 1000);
    return () => {
      clearInterval(timer);
      sequence.current++;
    };
  }, [refresh]);
  return (
    <AvatarContext.Provider value={{ urls, refresh }}>
      {children}
    </AvatarContext.Provider>
  );
}
