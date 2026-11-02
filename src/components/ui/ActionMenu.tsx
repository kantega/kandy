import React, { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";

export interface ActionMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Destructive actions are drawn in the danger colour. */
  danger?: boolean;
  /** Draw a divider above this item, to group related actions. */
  separated?: boolean;
}

interface ActionMenuProps {
  /** Accessible name and tooltip of the trigger. */
  label: string;
  items: ActionMenuItem[];
  className?: string;
}

/**
 * A `⋯` button that opens a short list of actions. Keeps rows of icon
 * buttons down to the one or two actions used most, with the rest one click
 * away.
 */
export const ActionMenu: React.FC<ActionMenuProps> = ({
  label,
  items,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex items-center rounded-md border border-transparent p-1 text-mid-gray cursor-pointer transition-colors hover:border-mid-gray/20 hover:bg-mid-gray/10 hover:text-text focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-md border border-mid-gray/80 bg-surface py-1 shadow-menu"
        >
          {items.map(
            ({
              label: itemLabel,
              icon: Icon,
              onSelect,
              disabled,
              danger,
              separated,
            }) => (
              <React.Fragment key={itemLabel}>
                {separated && (
                  <div className="my-1 border-t border-mid-gray/20" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => {
                    setIsOpen(false);
                    onSelect();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm transition-colors duration-150 hover:bg-logo-primary/10 focus:bg-logo-primary/10 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                    danger ? "text-danger" : ""
                  } ${disabled ? "" : "cursor-pointer"}`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${danger ? "" : "text-mid-gray"}`}
                  />
                  <span>{itemLabel}</span>
                </button>
              </React.Fragment>
            ),
          )}
        </div>
      )}
    </div>
  );
};
