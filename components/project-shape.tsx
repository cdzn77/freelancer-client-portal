"use client";
import { useState } from "react";
import shapes from "@/lib/shapes.json";
export function ProjectShape({
  shape = 1,
  className = "",
}: {
  shape?: number;
  className?: string;
}) {
  const asset = shapes.find((s) => s.id === shape) || shapes[0];
  return (
    <span
      aria-hidden="true"
      className={`project-shape ${className}`}
      style={{
        maskImage: `url(${asset.file})`,
        WebkitMaskImage: `url(${asset.file})`,
      }}
    />
  );
}
export function ShapePicker({ initial = 1 }: { initial?: number }) {
  const [selected, setSelected] = useState(initial),
    [search, setSearch] = useState("");
  const filtered = shapes.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <fieldset className="shape-library">
      <legend>Project shape</legend>
      <input type="hidden" name="shape_id" value={selected} />
      <p>
        Choose from all {shapes.length} shapes.{" "}
        Original geometric icons.
      </p>
      <label className="field">
        <span>Search shapes</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Shape number…"
        />
      </label>
      <div
        className="shape-grid"
        role="group"
        aria-label="Project shape library"
      >
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`shape-option ${s.id === selected ? "selected" : ""}`}
            aria-label={s.name}
            aria-pressed={s.id === selected}
            data-tooltip={`Use ${s.name} as this project's icon`}
            onClick={() => setSelected(s.id)}
          >
            <ProjectShape shape={s.id} />
            <small>{String(s.id).padStart(2, "0")}</small>
          </button>
        ))}
      </div>
      {!filtered.length && <p>No matching shapes.</p>}
      <p>Selected: Shape {String(selected).padStart(2, "0")}</p>
    </fieldset>
  );
}

const projectColors = [
  "coral",
  "green",
  "lilac",
  "blue",
  "amber",
  "rose",
  "teal",
  "mint",
  "peach",
  "indigo",
  "lemon",
  "slate",
];

export function ProjectColorPicker({
  initial = "coral",
}: {
  initial?: string;
}) {
  return (
    <fieldset className="project-color-picker">
      <legend>Project color</legend>
      <div className="project-color-options">
        {projectColors.map((color) => (
          <label key={color} className="project-color-option">
            <input
              type="radio"
              name="color"
              value={color}
              defaultChecked={color === initial}
            />
            <span
              aria-hidden="true"
              className={`project-color-swatch ${color}`}
            />
            <span>{color[0].toUpperCase() + color.slice(1)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
