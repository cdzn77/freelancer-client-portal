
import { brand } from "../lib/brand";
import type { ReactNode } from "react";
import { BrandLogo } from "./brand";
import styles from "./public-information.module.css";
export function PublicInformation({
  title,
  children,
  dated = false,
}: {
  title: string;
  children: ReactNode;
  dated?: boolean;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <a href="/about" aria-label={brand.appName + " overview"}>
            <BrandLogo />
          </a>
          <nav className={styles.nav} aria-label="Public information">
            <a href="/about">Overview</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
            <a href="/">Open workspace</a>
          </nav>
        </header>
        <main className={styles.content}>
          <p className={styles.kicker}>{brand.appName} · Studio workspace</p>
          <h1>{title}</h1>
          {dated && <p>Operator policy must be configured before accepting client data.</p>}
          {children}
        </main>
        <footer className={styles.footer}>
          <span>{brand.appName}</span>
          <a href={"mailto:" + brand.email}>Contact &amp; support</a>
          <a href="/privacy">Privacy policy</a>
          <a href="/terms">Terms of service</a>
        </footer>
      </div>
    </div>
  );
}
