import React from "react";

// Kandy lockup: real Kantega K-symbol + "Kandy" wordmark in Source Sans Pro
// SemiBold. The K path is the official Kantega logosymbol
// (logo/kantega/Kantega logosymbol K/Hvit/Kantega_K_hvit.svg), placed on the
// Kantega deep purple background from the brand palette. Colors match the app
// icon so the sidebar mark reads as the same brand as the tray/dock icon.
//
// `wordmark="text"` paints the word in the current text color (off-white on
// the dark sidebar and onboarding surfaces); the default keeps the coral.
const KandyTextLogo = ({
  width,
  height,
  className,
  wordmark = "accent",
}: {
  width?: number;
  height?: number;
  className?: string;
  wordmark?: "accent" | "text";
}) => {
  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox="0 0 1200 320"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* K-mark: rounded purple square with the Kantega K in Kantega off-white,
          plus a small coral microphone badge that signals "audio app" without
          overpowering the K glyph. */}
      {/* The hairline keeps the purple tile visible when the lockup itself
          sits on a purple surface. */}
      <rect
        x="4"
        y="4"
        width="312"
        height="312"
        rx="52"
        className="fill-purple stroke-off-white/30"
        strokeWidth="8"
      />
      <g transform="translate(56, 56) scale(0.79)">
        <path
          className="fill-off-white"
          d="M214.77,200.71c-1.73,0-3.84,1.54-13.05,1.54-59.65,0-45.9-67.06-92-79.26,42.63-9.66,81.5-52.76,81.5-64.83,0-10.17-7.67-17.65-15-17.65-2.58,0-38.48,69.47-85.74,74.86,9.23-23.77,18.21-43.57,18.21-52.8,0-15-12.86-22.83-20.53-22.83-.77,0-1.15.19-1.15.77,0,43.93-37,105.91-37,131.23,0,17.27,11.89,26.1,19.18,26.1,1.15,0,1.54-.39,1.54-1.54,0-22.34,7.28-47.11,15.47-69.5C132.51,135.29,117.8,217,182.92,217c22.26,0,33.19-12.08,33.19-15.15C216.11,201.1,215.54,200.71,214.77,200.71Z"
        />
      </g>
      {/* Microphone badge in the top-right corner of the K-mark */}
      <g transform="translate(232, 40)">
        <rect
          x="0"
          y="0"
          width="36"
          height="52"
          rx="18"
          className="fill-background-ui"
        />
        <path
          d="M-8 32 Q-8 52 18 52 Q44 52 44 32"
          className="stroke-background-ui"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
        />
        <line
          x1="18"
          y1="58"
          x2="18"
          y2="72"
          className="stroke-background-ui"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <line
          x1="6"
          y1="72"
          x2="30"
          y2="72"
          className="stroke-background-ui"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>

      {/* "Kandy" wordmark next to the K-mark */}
      <text
        x="380"
        y="160"
        dominantBaseline="central"
        fontFamily="'Source Sans Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        fontWeight={600}
        fontSize={220}
        letterSpacing="-4"
        className={wordmark === "text" ? "fill-text" : "logo-primary"}
      >
        {/* brand wordmark, not translatable copy */}
        {"Kandy"}
      </text>
    </svg>
  );
};

export default KandyTextLogo;
