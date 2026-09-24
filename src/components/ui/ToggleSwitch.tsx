import React from "react";
import { SettingContainer } from "./SettingContainer";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  isUpdating?: boolean;
  label: string;
  description: string;
  grouped?: boolean;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  isUpdating = false,
  label,
  description,
  grouped = false,
}) => {
  return (
    <SettingContainer
      title={label}
      description={description}
      grouped={grouped}
      disabled={disabled}
    >
      <label
        className={`flex items-center ${disabled || isUpdating ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <input
          type="checkbox"
          value=""
          className="sr-only peer"
          checked={checked}
          disabled={disabled || isUpdating}
          onChange={(e) => onChange(e.target.checked)}
        />
        {/* The knob is the page background with a mid-gray hairline rather than
            a hardcoded white pill: white reads as an unthemed hole punched in
            the dark purple UI, and on the light track it had no visible edge
            at all. Both tokens flip with the theme, so the knob stays legible
            against the unchecked gray track and the checked coral one. */}
        <div className="relative w-11 h-6 bg-mid-gray/20 peer-focus:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-background-ui peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-background after:border-mid-gray after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-background-ui peer-checked:bg-accent-gradient peer-disabled:opacity-50"></div>
      </label>
      {isUpdating && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-logo-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
    </SettingContainer>
  );
};
