"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
export function FilterSelect({
  label,
  value,
  onValueChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Menu.Root>
      <Menu.Trigger
        className="filter-select"
        aria-label={label}
        disabled={disabled}
      >
        <span>{current?.label || "Choose an option"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="filter-menu"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Menu.RadioGroup
            value={value}
            onValueChange={onValueChange}
            aria-label={label}
          >
            {options.map((option) => (
              <Menu.RadioItem
                className="filter-option"
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                textValue={option.label}
                onSelect={() => {
                  if (option.value === value) onValueChange(option.value);
                }}
              >
                <span>{option.label}</span>
                <Menu.ItemIndicator>
                  <Check size={15} aria-hidden="true" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
