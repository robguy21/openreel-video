import React from "react";
import { ToolcraftPopover as Popover } from "@openreel/ui";

/**
 * One item of the editor's rail: an icon over a 10 px label in a 58 px glass button, lit
 * when it is the chosen tab (docs/PROPOSAL_EDITOR_REDESIGN.md R4.1). The rail also holds
 * the editor's few global actions - back to the studio, Save, Export and "..." - since
 * the top bar is gone (Robert, 2026-09-28), and those that offer a choice open a menu
 * beside the rail.
 */

export const railItemClass = (lit: boolean, tone: "plain" | "primary" = "plain"): string =>
  `or-focus flex h-[50px] w-[58px] shrink-0 flex-col items-center justify-center gap-1 rounded-[18px] transition-colors disabled:cursor-default disabled:opacity-60 ${
    tone === "primary"
      ? "or-primary"
      : lit
        ? "or-lit"
        : "text-fg-3 hover:text-fg-2"
  }`;

export const RailGlyph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const RailLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="max-w-[54px] truncate text-[10px] leading-none">{children}</span>
);

type RailButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode;
  label: string;
  lit?: boolean;
  tone?: "plain" | "primary";
};

/** A rail item that does one thing. `label` is what shows; `aria-label` may say more. */
export const RailButton = React.forwardRef<HTMLButtonElement, RailButtonProps>(
  ({ icon, label, lit = false, tone = "plain", className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={rest["aria-label"] ?? label}
      title={rest.title ?? label}
      className={`${railItemClass(lit, tone)} ${className ?? ""}`}
      {...rest}
    >
      {icon}
      <RailLabel>{label}</RailLabel>
    </button>
  ),
);
RailButton.displayName = "RailButton";

export interface RailMenuEntry {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  isDisabled?: boolean;
  isDefault?: boolean;
}

/** A rail item that opens a menu beside the rail. `null` in `entries` draws a divider. */
export const RailMenu: React.FC<{
  trigger: React.ReactElement;
  label: string;
  entries: ReadonlyArray<RailMenuEntry | null>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  footer?: React.ReactNode;
  width?: number;
}> = ({ trigger, label, entries, isOpen, onOpenChange, footer, width = 260 }) => (
  <Popover
    isOpen={isOpen}
    onOpenChange={onOpenChange}
    placement="end"
    alignment="end"
    width={width}
    label={label}
    content={
      <div role="menu" aria-label={label} className="flex max-h-[70vh] flex-col overflow-y-auto p-1.5">
        {entries.map((entry, index) =>
          entry === null ? (
            <div key={`div-${index}`} className="mx-2 my-1 h-px shrink-0 bg-border" />
          ) : entry.href ? (
            <a
              key={entry.label}
              role="menuitem"
              href={entry.href}
              target="_blank"
              rel="noreferrer"
              onClick={() => onOpenChange(false)}
              className="or-focus flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[13px] text-fg hover:bg-hover"
            >
              {entry.icon}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            </a>
          ) : (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              disabled={entry.isDisabled}
              onClick={() => {
                onOpenChange(false);
                entry.onSelect?.();
              }}
              className={`or-focus flex items-start gap-2.5 rounded-[12px] px-2.5 py-2 text-left hover:bg-hover disabled:opacity-50 ${
                entry.isDefault ? "bg-accent-soft" : ""
              }`}
            >
              {entry.icon && <span className="mt-0.5 shrink-0 text-fg-2">{entry.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13px] ${entry.isDefault ? "font-medium text-accent-text" : "text-fg"}`}>
                  {entry.label}
                </span>
                {entry.description && (
                  <span className="block text-[11px] leading-snug text-fg-3">{entry.description}</span>
                )}
              </span>
            </button>
          ),
        )}
        {footer}
      </div>
    }
  >
    {trigger}
  </Popover>
);
