"use client";
import { Bell } from "lucide-react";
import { BrandLogo } from "./brand";
import { Avatar } from "./ui";
export function ClientNavigation({
  page,
  view,
  name,
  userId,
  onNavigate,
}: {
  page: string;
  view: string;
  name: string;
  userId?: string;
  onNavigate: (destination: string) => void;
}) {
  return (
    <header className="cp-topbar">
      <button
        className="cp-brand"
        aria-label="Client home"
        onClick={() => onNavigate("Home")}
      >
        <BrandLogo />
      </button>
      <nav aria-label="Client navigation">
        {["Home", "Projects", "Documents", "Messages"].map((label) => (
          <button
            key={label}
            aria-current={
              label === "Documents"
                ? page === "Documents & payments"
                  ? "page"
                  : undefined
                : page === "Client portal" &&
                    (view === label ||
                      (label === "Projects" && view === "Project"))
                  ? "page"
                  : undefined
            }
            onClick={() => onNavigate(label)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="cp-account-links">
        <button aria-label="Your updates" onClick={() => onNavigate("Inbox")}>
          <Bell size={18} />
          <span>Updates</span>
        </button>
        <button
          aria-label="Edit profile and password"
          onClick={() => onNavigate("Profile")}
        >
          <Avatar name={name} userId={userId} />
          <span>Profile</span>
        </button>
      </div>
    </header>
  );
}
