/** Decorative studio asterisk. Inline SVG avoids platform emoji fonts. */
export function StudioMark() {
  return (
    <svg
      className="studio-mark"
      width="1em"
      height="1em"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16 2v28M2 16h28M6.1 6.1l19.8 19.8M6.1 25.9 25.9 6.1" />
    </svg>
  );
}
