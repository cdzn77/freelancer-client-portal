import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
async function main() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost",
  });
  for (const name of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLFormElement",
    "HTMLSelectElement",
    "HTMLInputElement",
    "Element",
    "Node",
    "DocumentFragment",
    "MutationObserver",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "FocusEvent",
    "getComputedStyle",
  ])
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: (dom.window as any)[name],
    });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.Element.prototype.hasPointerCapture = function () {
    return false;
  };
  dom.window.Element.prototype.setPointerCapture = function () {};
  dom.window.Element.prototype.releasePointerCapture = function () {};
  const React = await import("react");
  const { render, screen, cleanup } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  const { Select } = await import("../components/select");
  const user = userEvent.setup({ document: dom.window.document });
  let changed = "";
  const view = render(
    <form aria-label="Test form">
      <label>
        Type
        <Select
          name="kind"
          defaultValue="text"
          onChange={(e) => (changed = e.target.value)}
        >
          <option>text</option>
          <option>number</option>
          <option>date</option>
        </Select>
      </label>
    </form>,
  );
  const trigger = screen.getByRole("combobox", { name: /Type/ });
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: "number" }));
  assert.equal(changed, "number");
  assert.match(trigger.textContent || "", /number/);
  assert.equal(
    new dom.window.FormData(view.container.querySelector("form")!).get("kind"),
    "number",
  );
  await user.click(trigger);
  await user.keyboard("{Escape}");
  assert.equal(dom.window.document.activeElement, trigger);
  await React.act(async () => view.container.querySelector("form")!.reset());
  assert.equal(
    new dom.window.FormData(view.container.querySelector("form")!).get("kind"),
    "text",
  );
  cleanup();
  const required = render(
    <form>
      <label>
        Project
        <Select name="project" required defaultValue="">
          <option value="" disabled>
            Choose project
          </option>
          <option value="p1">First project</option>
        </Select>
      </label>
    </form>,
  );
  await React.act(async () => {
    assert.equal(
      required.container.querySelector("form")!.checkValidity(),
      false,
    );
  });
  assert.equal(
    dom.window.document.activeElement,
    screen.getByRole("combobox", { name: /Project/ }),
  );
  await user.click(screen.getByRole("combobox", { name: /Project/ }));
  await user.click(screen.getByRole("option", { name: "First project" }));
  assert.equal(required.container.querySelector("form")!.checkValidity(), true);
  assert.equal(
    new dom.window.FormData(required.container.querySelector("form")!).get(
      "project",
    ),
    "p1",
  );
  cleanup();
  const controlled = render(
    <label>
      Optional
      <Select value="" onChange={(e) => (changed = e.target.value)}>
        <option value="">Not set</option>
        <option value="yes">Yes</option>
      </Select>
    </label>,
  );
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByRole("option", { name: "Yes" }));
  assert.equal(changed, "yes");
  assert.match(screen.getByRole("combobox").textContent || "", /Not set/);
  controlled.unmount();
  render(
    <Select
      aria-label="Workspace"
      value="one"
      onChange={() => {}}
      triggerContent={
        <>
          <span>Studio</span>
          <svg data-testid="workspace-arrow" />
        </>
      }
    >
      <option value="one">Studio</option>
      <option value="two">Other studio</option>
    </Select>,
  );
  await user.click(screen.getByTestId("workspace-arrow"));
  assert.ok(screen.getByRole("option", { name: "Other studio" }));
  await user.keyboard("{Escape}");
  cleanup();
  console.log(
    "PASS: styled menu selection, real change events, form values, reset, required validation/focus, controlled values, Escape focus return.",
  );
  dom.window.close();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
