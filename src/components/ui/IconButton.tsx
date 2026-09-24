import React from "react";

interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name. Also used as the tooltip. */
  label: string;
  active?: boolean;
}

/**
 * Square icon-only button for compact action rows. The label doubles as the
 * tooltip so every instance has an accessible name.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  label,
  active = false,
  className = "",
  children,
  type = "button",
  ...props
}) => (
  <button
    type={type}
    aria-label={label}
    title={label}
    className={`p-1.5 rounded-md flex items-center justify-center transition-colors cursor-pointer border border-transparent focus:outline-none focus-visible:ring-1 focus-visible:ring-logo-primary disabled:cursor-not-allowed disabled:text-text/40 disabled:hover:bg-transparent hover:bg-mid-gray/10 ${
      active
        ? "text-logo-primary hover:text-logo-primary/80"
        : "text-text/60 hover:text-logo-primary"
    } ${className}`}
    {...props}
  >
    {children}
  </button>
);
