"use client";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
type Option = { value: string; label: string; disabled: boolean };
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? text(child.props.children)
        : String(child),
    )
    .join("");
}
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (child.type === "option") {
      const label = text(child.props.children);
      return [
        {
          value: String(child.props.value ?? label),
          label,
          disabled: !!child.props.disabled,
        },
      ];
    }
    return optionsFrom(child.props.children);
  });
}
/** Styled selection with a real form control for FormData, required validation and reset. */
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  name,
  required,
  disabled,
  id,
  className,
  triggerContent,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { triggerContent?: ReactNode }) {
  const options = optionsFrom(children),
    generated = useId();
  const initial = String(defaultValue ?? options[0]?.value ?? "");
  const [internal, setInternal] = useState(initial),
    [invalid, setInvalid] = useState(false);
  const current =
    value === undefined
      ? options.some((option) => option.value === internal)
        ? internal
        : options[0]?.value || ""
      : String(value);
  const native = useRef<HTMLSelectElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === current);
  useEffect(() => {
    const form = native.current?.form;
    if (!form) return;
    const reset = () => {
      setInternal(initial);
      setInvalid(false);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial]);
  const change = (next: string) => {
    const control = native.current;
    if (!control) return;
    control.value = next;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  };
  return (
    <span className={`select-control ${className || ""}`}>
      <SelectPrimitive.Root
        value={`value:${current}`}
        disabled={disabled}
        onValueChange={(encoded) => change(encoded.slice(6))}
      >
        <SelectPrimitive.Trigger
          ref={trigger}
          id={id || generated}
          className="select-trigger"
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
          aria-describedby={props["aria-describedby"]}
          aria-required={required}
          aria-invalid={invalid || props["aria-invalid"]}
          title={props.title}
        >
          {triggerContent || (
            <>
              <SelectPrimitive.Value>
                {selected?.label || "Choose an option"}
              </SelectPrimitive.Value>
              <SelectPrimitive.Icon>
                <ChevronDown size={16} aria-hidden="true" />
              </SelectPrimitive.Icon>
            </>
          )}
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="select-menu"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <SelectPrimitive.ScrollUpButton className="select-scroll">
              <ChevronUp size={16} />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={`value:${option.value}`}
                  disabled={option.disabled}
                  className="select-option"
                  textValue={option.label}
                >
                  <SelectPrimitive.ItemText>
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check size={15} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="select-scroll">
              <ChevronDown size={16} />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      <select
        ref={native}
        className="select-form-control"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={current}
        required={required}
        disabled={disabled}
        onChange={(event) => {
          setInternal(event.target.value);
          setInvalid(false);
          onChange?.(event);
        }}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
        }}
      >
        {children}
      </select>
      {invalid && (
        <span className="select-validation" role="alert">
          Choose an option.
        </span>
      )}
    </span>
  );
}
