import type { Locator } from "@playwright/test";
export async function chooseOption(
  trigger: Locator,
  choice: string | { label: string },
) {
  await trigger.waitFor({ state: "visible" });
  const wrapper = trigger.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " select-control ")][1]',
  );
  await wrapper
    .locator("select.select-form-control option")
    .first()
    .waitFor({ state: "attached" });
  const label =
    typeof choice === "string"
      ? await wrapper
          .locator("select.select-form-control option")
          .evaluateAll((options, value) => {
            const match = (options as HTMLOptionElement[]).find(
              (o) => o.value === value,
            );
            if (!match) throw Error("Option not found: " + value);
            return match.textContent || "";
          }, choice)
      : choice.label;
  await trigger.click();
  await trigger
    .page()
    .getByRole("option", { name: label, exact: true })
    .click();
}
