import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Studio } from "../components/studio";
import { Tooltips } from "../components/tooltips";
import { demoFetch, demoSession, resetDemo, setDemoRole } from "./backend";
import { brand } from "../lib/brand";
import "@fontsource-variable/inter";
import "./demo.css";

window.fetch = demoFetch;
class DemoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="demo-error"><h1>Let’s reopen the demo.</h1><p>This view could not be displayed. Reload to restore the fictional workspace.</p><button onClick={() => location.reload()}>Reset demo</button></main>;
    return this.props.children;
  }
}
function Demo() {
  const [role, setRole] = useState<"freelancer" | "client">("freelancer");
  const [version, setVersion] = useState(0);
  const [info, setInfo] = useState(false);
  const chrome = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const measure = () => document.documentElement.style.setProperty("--demo-chrome-height", `${chrome.current?.offsetHeight || 90}px`);
    const observer = new ResizeObserver(measure);
    if (chrome.current) observer.observe(chrome.current);
    measure();
    return () => observer.disconnect();
  }, []);
  function switchRole(next: "freelancer" | "client") {
    setDemoRole(next === "client"); setRole(next); setVersion(v => v + 1);
    history.replaceState({}, "", location.pathname);
  }
  useEffect(() => {
    const exit = () => switchRole(role === "client" ? "freelancer" : "client");
    window.addEventListener("demo-exit", exit);
    return () => window.removeEventListener("demo-exit", exit);
  }, [role]);
  return <>
    <div className="demo-chrome" ref={chrome}>
    <aside className="demo-bar" aria-label="Demo controls">
      <div className="demo-label"><span className="demo-dot" /><strong>Freelancer Client Portal</strong><span className="demo-badge">LIVE DEMO</span></div>
      <div className="demo-controls">
        <div className="demo-switch" aria-label="Demo perspective">
          <button aria-pressed={role === "freelancer"} onClick={() => switchRole("freelancer")}>Freelancer</button>
          <button aria-pressed={role === "client"} onClick={() => switchRole("client")}>Client view</button>
        </div>
        <button className="demo-quiet" onClick={() => { resetDemo(); switchRole(role); }}>Reset demo</button>
        <button className="demo-quiet" aria-expanded={info} onClick={() => setInfo(!info)}>About this demo</button>
        <a className="demo-get" href="https://github.com/cdzn77/freelancer-client-portal" target="_blank" rel="noreferrer">Get the portal ↗</a>
      </div>
    </aside>
    {info && <section className="demo-info"><strong>A sample workspace, ready to explore.</strong><p>Browse projects, edit tasks, track time, and switch to the client’s perspective. All names and records are fictional. Changes stay in this browser tab and reset when you reload. Email, payments, uploads, account changes, AI, and external integrations need your own installation.</p><a href="/help/guide.pdf" target="_blank" rel="noreferrer">Read the 40-page installation and user guide ↗</a></section>}
    <div className="demo-caption" role="note">Fictional data · Changes stay in this tab · No real email or payments</div>
    </div>
    <DemoBoundary key={version}><Studio session={demoSession()} /></DemoBoundary>
    <Tooltips />
  </>;
}
document.body.style.setProperty("--brand-accent", brand.accentColor);
document.body.style.setProperty("--brand-accent-text", brand.accentTextColor);
createRoot(document.getElementById("root")!).render(<Demo />);
