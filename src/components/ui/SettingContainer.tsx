import React from "react";

interface SettingContainerProps {
  title: string;
  description: string;
  children: React.ReactNode;
  grouped?: boolean;
  layout?: "horizontal" | "stacked";
  disabled?: boolean;
}

/**
 * One labelled setting row. The description is always visible as muted text
 * under the title so the user never has to hunt for an info icon.
 */
export const SettingContainer: React.FC<SettingContainerProps> = ({
  title,
  description,
  children,
  grouped = false,
  layout = "horizontal",
  disabled = false,
}) => {
  const frame = grouped ? "" : "rounded-lg border border-mid-gray/20";
  const dim = disabled ? "opacity-50" : "";

  const heading = (
    <div className={`min-w-0 ${dim}`}>
      <h3 className="text-sm font-medium text-text leading-snug">{title}</h3>
      {description && (
        <p className="text-xs text-mid-gray leading-snug mt-0.5">
          {description}
        </p>
      )}
    </div>
  );

  if (layout === "stacked") {
    return (
      <div className={`px-4 py-3 flex flex-col gap-3 ${frame}`}>
        {heading}
        <div className="w-full">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={`px-4 py-3 flex items-center justify-between gap-6 min-h-14 ${frame}`}
    >
      <div className="flex-1 min-w-0 max-w-[60%]">{heading}</div>
      <div className="relative shrink-0 flex items-center">{children}</div>
    </div>
  );
};
