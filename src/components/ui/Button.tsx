import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "warning"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "font-medium rounded-lg border focus:outline-none transition-[color,background-color,border-color,filter] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

  const variantClasses = {
    // Off-white label on the dark coral fill; both ends of the gradient clear
    // AA for normal text (theme.css).
    primary:
      "text-on-accent bg-background-ui bg-accent-gradient border-transparent hover:brightness-110 focus-visible:ring-2 focus-visible:ring-background-ui focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "primary-soft":
      "text-text bg-logo-primary/20 border-transparent hover:bg-logo-primary/30 focus:ring-1 focus:ring-logo-primary",
    secondary:
      "bg-mid-gray/10 border-mid-gray/20 hover:bg-background-ui/30 hover:border-logo-primary focus:outline-none",
    // Secondary's neutral resting look, but hover/focus use the semantic
    // --color-warning token (theme.css) instead of the pink accent — for
    // buttons sitting on warning surfaces like SecureInputWarning
    warning:
      "text-text bg-mid-gray/10 border-mid-gray/20 hover:bg-warning/15 hover:border-warning focus:ring-1 focus:ring-warning",
    // Destructive actions use --color-danger, which is kept distinct from the
    // coral primary in both themes so "delete" never looks like "confirm".
    danger:
      "text-on-danger bg-danger border-danger hover:bg-danger/85 hover:border-danger/85 focus:ring-1 focus:ring-danger",
    "danger-ghost":
      "text-error border-transparent hover:bg-error/10 focus:bg-error/20",
    ghost:
      "text-current border-transparent hover:bg-mid-gray/10 hover:border-logo-primary focus:bg-mid-gray/20",
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-4 py-[5px] text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
