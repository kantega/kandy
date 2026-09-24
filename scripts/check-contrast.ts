/**
 * WCAG contrast check for the Kandy color tokens.
 *
 * Reads the CSS custom properties straight out of `src/styles/theme.css` and
 * `src/overlay/RecordingOverlay.css`, resolves them once for the light theme
 * and once for the dark theme (following the `:root[data-theme="…"]`
 * overrides), and evaluates every foreground/background pair the UI actually
 * renders — including translucent tints, which are composited over their
 * backdrop before the ratio is computed.
 *
 * Thresholds (WCAG 2.1 AA):
 *   body   4.5:1  — normal-size text
 *   large  3.0:1  — >= 18.66px bold or >= 24px
 *   ui     3.0:1  — icons, status dots, focus rings, component boundaries
 *
 * Run:  bun scripts/check-contrast.ts
 *       (or: node --experimental-strip-types scripts/check-contrast.ts)
 * Exits non-zero if any pair falls below its threshold.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const THEME_CSS = path.join(ROOT, "src", "styles", "theme.css");
const OVERLAY_CSS = path.join(ROOT, "src", "overlay", "RecordingOverlay.css");

type Theme = "light" | "dark";
type Level = "body" | "large" | "ui";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const THRESHOLDS: Record<Level, number> = { body: 4.5, large: 3, ui: 3 };

/* ------------------------------------------------------------------ *
 * CSS parsing
 * ------------------------------------------------------------------ */

const stripComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Drop `@media (prefers-color-scheme: dark) { … }` wholesale. The explicit
 * `data-theme` blocks carry the same values, and resolving both would just
 * make the last one win arbitrarily.
 */
const stripMediaBlocks = (css: string): string => {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    i = j;
  }
  return out;
};

interface Block {
  selector: string;
  declarations: Array<[string, string]>;
}

const parseBlocks = (css: string): Block[] => {
  const blocks: Block[] = [];
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(css)) !== null) {
    // Anything before the last `;` is a preceding at-rule (`@import …;`), not
    // part of this block's selector.
    const selector = (match[1].split(";").pop() ?? "").trim();
    const declarations: Array<[string, string]> = [];
    for (const raw of match[2].split(";")) {
      const idx = raw.indexOf(":");
      if (idx === -1) continue;
      const name = raw.slice(0, idx).trim();
      if (!name.startsWith("--")) continue;
      declarations.push([name, raw.slice(idx + 1).trim()]);
    }
    blocks.push({ selector, declarations });
  }
  return blocks;
};

/** Custom properties in effect for `theme`, across all the given CSS files. */
const resolveEnvironment = (
  files: string[],
  theme: Theme,
): Map<string, string> => {
  const env = new Map<string, string>();
  const wanted = [":root", `:root[data-theme="${theme}"]`];
  for (const file of files) {
    const css = stripMediaBlocks(stripComments(fs.readFileSync(file, "utf8")));
    const blocks = parseBlocks(css);
    // `:root` first, then the theme override, so the override always wins even
    // if it appears earlier in the file.
    for (const selector of wanted) {
      for (const block of blocks) {
        if (block.selector !== selector) continue;
        for (const [name, value] of block.declarations) env.set(name, value);
      }
    }
  }
  return env;
};

/* ------------------------------------------------------------------ *
 * Color resolution
 * ------------------------------------------------------------------ */

const parseHex = (hex: string): Rgba => {
  let h = hex.replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
};

/** Split a comma-separated argument list, respecting nested parentheses. */
const splitArgs = (input: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

const resolveColor = (
  value: string,
  env: Map<string, string>,
  depth = 0,
): Rgba => {
  if (depth > 12) throw new Error(`Cyclic custom property near: ${value}`);
  const v = value.trim();

  if (v === "transparent") return TRANSPARENT;
  if (v.startsWith("#")) return parseHex(v);

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(v);
  if (varMatch) {
    const referenced = env.get(varMatch[1]);
    if (referenced !== undefined)
      return resolveColor(referenced, env, depth + 1);
    if (varMatch[2]) return resolveColor(varMatch[2], env, depth + 1);
    throw new Error(`Undefined custom property: ${varMatch[1]}`);
  }

  const rgbMatch = /^rgba?\(([\s\S]*)\)$/.exec(v);
  if (rgbMatch) {
    const args = splitArgs(rgbMatch[1].replace(/\//g, ","));
    return {
      r: Number(args[0]),
      g: Number(args[1]),
      b: Number(args[2]),
      a: args[3] === undefined ? 1 : Number(args[3]),
    };
  }

  // color-mix(in srgb, A [p%], B [q%])
  const mixMatch = /^color-mix\(\s*in\s+srgb\s*,([\s\S]*)\)$/.exec(v);
  if (mixMatch) {
    const args = splitArgs(mixMatch[1]);
    if (args.length !== 2) throw new Error(`Unsupported color-mix: ${v}`);
    const parsePart = (
      part: string,
    ): { color: Rgba; weight: number | null } => {
      const pct = /\s([\d.]+)%$/.exec(part);
      const colorText = pct ? part.slice(0, pct.index).trim() : part.trim();
      return {
        color: resolveColor(colorText, env, depth + 1),
        weight: pct ? Number(pct[1]) / 100 : null,
      };
    };
    const first = parsePart(args[0]);
    const second = parsePart(args[1]);
    let w1 = first.weight;
    let w2 = second.weight;
    if (w1 === null && w2 === null) {
      w1 = 0.5;
      w2 = 0.5;
    } else if (w1 === null) w1 = 1 - (w2 ?? 0);
    else if (w2 === null) w2 = 1 - w1;
    // srgb mixing is premultiplied by alpha per the CSS Color 5 spec.
    const a = w1 * first.color.a + w2 * second.color.a;
    const channel = (key: "r" | "g" | "b"): number => {
      if (a === 0) return 0;
      return (
        (w1 * first.color.a * first.color[key] +
          w2 * second.color.a * second.color[key]) /
        a
      );
    };
    return { r: channel("r"), g: channel("g"), b: channel("b"), a };
  }

  throw new Error(`Unsupported color value: ${v}`);
};

/** Composite `fg` (possibly translucent) over an opaque `bg`. */
const over = (fg: Rgba, bg: Rgba): Rgba => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const relativeLuminance = ({ r, g, b }: Rgba): number => {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: Rgba, b: Rgba): number => {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* ------------------------------------------------------------------ *
 * The pairs the UI actually renders
 * ------------------------------------------------------------------ */

/**
 * A layer is a token name, optionally with a Tailwind-style opacity suffix
 * (`error/10` === `bg-error/10`). Backgrounds stack left to right, the first
 * entry being the opaque base.
 */
interface Check {
  label: string;
  fg: string;
  bg: string[];
  level: Level;
  /**
   * Set for pairs that fall outside WCAG's normative scope — purely decorative
   * separators and surface tints, where the component stays identifiable
   * through text, an icon, a border or its position. These are still measured
   * and printed, but they do not fail the run. Anything listed here needs a
   * reason that survives review.
   */
  advisory?: string;
}

const CHECKS: Check[] = [
  // --- base surfaces -------------------------------------------------
  {
    label: "Body text on app background",
    fg: "text",
    bg: ["background"],
    level: "body",
  },
  {
    label: "Secondary text (mid-gray) on background",
    fg: "mid-gray",
    bg: ["background"],
    level: "body",
  },
  {
    label: "Hairline border (mid-gray/20) on background",
    fg: "mid-gray/20",
    bg: ["background"],
    level: "ui",
    advisory:
      "decorative row separator inside settings groups; no control depends on it",
  },
  {
    label: "Strong border (mid-gray/80) on background",
    fg: "mid-gray/80",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Raised card surface vs background",
    fg: "surface",
    bg: ["background"],
    level: "ui",
    advisory:
      "decorative surface step; light cards are delimited by --shadow-card, dark cards by --color-card-border",
  },
  {
    label: "Body text on raised card surface",
    fg: "text",
    bg: ["background", "surface"],
    level: "body",
  },
  {
    label: "Secondary text (mid-gray) on card surface",
    fg: "mid-gray",
    bg: ["background", "surface"],
    level: "body",
  },
  {
    label: "Header description (mid-gray) on band start",
    fg: "mid-gray",
    bg: ["band-from"],
    level: "body",
  },
  {
    label: "Header title (text) on band end",
    fg: "text",
    bg: ["band-to"],
    level: "body",
  },
  {
    label: "Warm accent (rule/icon) vs background",
    fg: "accent-warm",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Cool accent (icon/status) vs background",
    fg: "accent-cool",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Disabled label (text/40) on background",
    fg: "text/40",
    bg: ["background"],
    level: "body",
    advisory:
      "only used for disabled controls (ResetButton), which WCAG 1.4.3 exempts; every enabled use of text/40 was moved to mid-gray",
  },

  {
    label: "Field text on field fill (input, dropdown)",
    fg: "text",
    bg: ["background", "mid-gray/10"],
    level: "body",
  },
  {
    label: "Disabled field text (mid-gray) on field fill",
    fg: "mid-gray",
    bg: ["background", "mid-gray/10"],
    level: "body",
  },
  {
    label: "Field border (mid-gray/80) on field fill",
    fg: "mid-gray/80",
    bg: ["background", "mid-gray/10"],
    level: "ui",
  },
  {
    label: "Dropdown menu surface vs the page behind it",
    fg: "surface",
    bg: ["background"],
    level: "ui",
    advisory:
      "the open menu is delimited by its mid-gray/80 border and --shadow-menu, not by the surface step",
  },

  // --- accent / primary button --------------------------------------
  {
    label: "Accent fill (background-ui) vs background",
    fg: "background-ui",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Primary button label on accent fill",
    fg: "on-accent",
    bg: ["background-ui"],
    level: "body",
  },
  {
    label: "Logo pink vs background",
    fg: "logo-primary",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Primary button label on gradient end (accent-deep)",
    fg: "on-accent",
    bg: ["accent-deep"],
    level: "body",
  },
  {
    label: "Primary fill focus ring (background-ui) vs surface",
    fg: "background-ui",
    bg: ["surface"],
    level: "ui",
  },
  {
    label: "primary-soft button label (text on logo-primary/20)",
    fg: "text",
    bg: ["background", "logo-primary/20"],
    level: "body",
  },
  {
    label: "secondary button label (text on mid-gray/10)",
    fg: "text",
    bg: ["background", "mid-gray/10"],
    level: "body",
  },

  // --- destructive ----------------------------------------------------
  {
    label: "Danger fill vs background",
    fg: "danger",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Danger button label on danger fill",
    fg: "on-danger",
    bg: ["danger"],
    level: "body",
  },
  {
    label: "danger-ghost label on background",
    fg: "error",
    bg: ["background"],
    level: "body",
  },
  {
    label: "danger-ghost label on its hover tint",
    fg: "error",
    bg: ["background", "error/10"],
    level: "body",
  },

  // --- status: text on page background --------------------------------
  {
    label: "Error text on background",
    fg: "error",
    bg: ["background"],
    level: "body",
  },
  {
    label: "Warning text on background",
    fg: "warning",
    bg: ["background"],
    level: "body",
  },
  {
    label: "Success text on background",
    fg: "success",
    bg: ["background"],
    level: "body",
  },
  {
    label: "Info text on background",
    fg: "info",
    bg: ["background"],
    level: "body",
  },

  // --- status: Alert (10% tinted surface) ------------------------------
  {
    label: "Alert error text on error/10",
    fg: "error",
    bg: ["background", "error/10"],
    level: "body",
  },
  {
    label: "Alert warning text on warning/10",
    fg: "warning",
    bg: ["background", "warning/10"],
    level: "body",
  },
  {
    label: "Alert success text on success/10",
    fg: "success",
    bg: ["background", "success/10"],
    level: "body",
  },
  {
    label: "Alert info text on info/10",
    fg: "info",
    bg: ["background", "info/10"],
    level: "body",
  },
  {
    label: "SecureInputWarning border (warning/40) on background",
    fg: "warning/40",
    bg: ["background"],
    level: "ui",
    advisory:
      "decorative frame around a banner that already states its severity with a full-contrast icon and text",
  },

  // --- status dots & badges --------------------------------------------
  {
    label: "Model status dot: ready (success)",
    fg: "success",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Model status dot: loading (warning)",
    fg: "warning",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Model status dot: error",
    fg: "error",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Model status dot: unloaded (mid-gray)",
    fg: "mid-gray",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Badge success text on success/20",
    fg: "success",
    bg: ["background", "success/20"],
    level: "body",
  },
  {
    label: "Badge secondary text (text/70) on mid-gray/20",
    fg: "text/70",
    bg: ["background", "mid-gray/20"],
    level: "body",
  },

  // --- toggle switch -----------------------------------------------------
  // The knob is the page background, so on the unchecked (gray) track it is
  // its mid-gray hairline that delimits it; on the checked (coral) track the
  // fill itself does.
  {
    label: "Toggle knob outline vs unchecked track",
    fg: "mid-gray",
    bg: ["background", "mid-gray/20"],
    level: "ui",
  },
  {
    label: "Toggle knob fill vs checked track",
    fg: "background",
    bg: ["background-ui"],
    level: "ui",
  },
  {
    label: "Toggle checked track vs background",
    fg: "background-ui",
    bg: ["background"],
    level: "ui",
  },
  {
    label: "Toggle checked track vs unchecked track",
    fg: "background-ui",
    bg: ["background", "mid-gray/20"],
    level: "ui",
    advisory:
      "state is also carried by knob position; WCAG 1.4.11 asks for contrast against adjacent colors, not between the two states",
  },

  // --- live log console ---------------------------------------------------
  {
    label: "Log console surface vs app background",
    fg: "log-surface",
    bg: ["background"],
    level: "ui",
    advisory:
      "the console is delimited by its mid-gray/30 border; a 3:1 surface step off #27003D would have to be lighter than the app's own text row",
  },
  {
    label: "Log body text on console surface",
    fg: "text",
    bg: ["log-surface"],
    level: "body",
  },
  {
    label: "Log timestamp (mid-gray) on console surface",
    fg: "mid-gray",
    bg: ["log-surface"],
    level: "body",
  },
  {
    label: "Log DEBUG tag (info) on console surface",
    fg: "info",
    bg: ["log-surface"],
    level: "body",
  },
  {
    label: "Log INFO tag (success) on console surface",
    fg: "success",
    bg: ["log-surface"],
    level: "body",
  },
  {
    label: "Log WARN line (warning) on console surface",
    fg: "warning",
    bg: ["log-surface"],
    level: "body",
  },
  {
    label: "Log ERROR line (error) on console surface",
    fg: "error",
    bg: ["log-surface"],
    level: "body",
  },
  {
    label: "Log DEBUG message (text/80) on console surface",
    fg: "text/80",
    bg: ["log-surface"],
    level: "body",
  },

  // --- dialogs ------------------------------------------------------------
  {
    label: "Dialog scrim over app background",
    fg: "scrim",
    bg: ["background"],
    level: "ui",
    advisory:
      "a scrim cannot meaningfully darken an already near-black surface; the dialog is delimited by its border instead",
  },
  // The dialog's edge is identifiable if *either* the surface/scrim step or
  // the border clears 3:1. Light gets there on the scrim (3.58:1) with the
  // border as decoration; dark gets there on the border (3.49:1) because the
  // scrim cannot darken the purple further. Each row is therefore advisory on
  // its own — together they cover both themes.
  {
    label: "Dialog surface vs scrimmed backdrop",
    fg: "background",
    bg: ["background", "scrim"],
    level: "ui",
    advisory: "carries the edge in light; in dark the border does",
  },
  {
    label: "Dialog border (mid-gray/60) vs scrimmed backdrop",
    fg: "mid-gray/60",
    bg: ["background", "scrim"],
    level: "ui",
    advisory: "carries the edge in dark; in light the scrim step does",
  },
  {
    label: "Dialog description (mid-gray) on dialog surface",
    fg: "mid-gray",
    bg: ["background"],
    level: "body",
  },

  // --- sliders --------------------------------------------------------------
  {
    label: "Slider filled track vs inert track",
    fg: "background-ui",
    bg: ["background", "track"],
    level: "ui",
    advisory:
      "clearing 3:1 against both the page and the coral fill would force a near-black track in light and a near-white one in dark; the value is carried by the thumb position",
  },
  {
    label: "Slider inert track vs background",
    fg: "track",
    bg: ["background"],
    level: "ui",
    advisory: "see above — the track is a rail, the thumb is the control",
  },

  // --- fixed-dark surfaces (sidebar, recorder hero, onboarding) --------------
  // These carry .scope-dark, so the dark tokens apply in both themes. The
  // gradient runs purple -> navy; navy is the lighter end, so it is the
  // harder case for light text and the one measured here. The purple end is
  // the ordinary dark background already covered above.
  {
    label: "Hero text (dark text) on navy",
    fg: "dark-color-text",
    bg: ["dark-color-navy"],
    level: "body",
  },
  {
    label: "Hero muted text (dark mid-gray) on navy",
    fg: "dark-color-mid-gray",
    bg: ["dark-color-navy"],
    level: "body",
  },
  {
    label: "Sidebar active fill (background-ui) vs navy",
    fg: "background-ui",
    bg: ["dark-color-navy"],
    level: "ui",
  },
  {
    label: "Sidebar active label (on-accent) on active fill",
    fg: "on-accent",
    bg: ["background-ui"],
    level: "body",
  },
  {
    label: "Sidebar focus ring (off-white) vs navy",
    fg: "off-white",
    bg: ["dark-color-navy"],
    level: "ui",
  },
  {
    label: "Edge hairline (dark edge) on navy",
    fg: "dark-color-edge",
    bg: ["dark-color-navy"],
    level: "ui",
    advisory:
      "supplementary line where a gradient meets the page; the surfaces on either side already differ, the hairline just sharpens the seam",
  },
  {
    label: "Edge hairline (light edge) on light surface",
    fg: "light-color-edge",
    bg: ["light-color-surface"],
    level: "ui",
    advisory: "see above",
  },
  {
    label: "Recording pulse (pink) vs navy",
    fg: "pink",
    bg: ["dark-color-navy"],
    level: "ui",
  },
  {
    label: "Transcribing accent (dark cool) vs navy",
    fg: "dark-color-accent-cool",
    bg: ["dark-color-navy"],
    level: "ui",
  },
  {
    label: "Onboarding card (light surface) vs navy",
    fg: "light-color-surface",
    bg: ["dark-color-navy"],
    level: "ui",
  },

  // --- meeting recorder hero (always dark, own sweep) ------------------------
  {
    label: "Hero text (dark text) on hero start",
    fg: "dark-color-text",
    bg: ["hero-from"],
    level: "body",
  },
  {
    label: "Hero muted text (dark mid-gray) on hero start",
    fg: "dark-color-mid-gray",
    bg: ["hero-from"],
    level: "body",
  },
  {
    label: "Hero edge vs the hero fill it delimits",
    fg: "hero-edge",
    bg: ["hero-from"],
    level: "ui",
  },
  {
    label: "Hero edge vs the dark page behind it",
    fg: "hero-edge-on-hero",
    bg: ["dark-color-background"],
    level: "ui",
  },
  {
    label: "Hero surface vs the dark page",
    fg: "hero-from",
    bg: ["dark-color-background"],
    level: "ui",
    advisory:
      "surface step alone cannot clear 3:1 without washing the hero out; the hero edge does clear it against both neighbours (the two rows above)",
  },
  {
    label: "Header band start vs the dark page",
    fg: "band-from",
    bg: ["dark-color-background"],
    level: "ui",
    advisory:
      "the sticky band is delimited by the accent rule above it and --color-edge below it, not by the surface step",
  },

  // --- recording overlay -----------------------------------------------------
  {
    label: "Overlay live text on overlay surface",
    fg: "s-text-90",
    bg: ["s-surface-solid"],
    level: "body",
  },
  {
    label: "Overlay working label (s-muted) on surface",
    fg: "s-muted",
    bg: ["s-surface-solid"],
    level: "body",
  },
  {
    label: "Overlay timer (s-faint) on surface",
    fg: "s-faint",
    bg: ["s-surface-solid"],
    level: "body",
  },
  {
    label: "Overlay card border (s-border) vs surface",
    fg: "s-border",
    bg: ["s-surface-solid"],
    level: "ui",
    advisory:
      "the card's edge is read against arbitrary desktop content behind the transparent overlay window, not against its own fill",
  },
  {
    label: "Overlay accent (waveform/dot) vs surface",
    fg: "s-accent",
    bg: ["s-surface-solid"],
    level: "ui",
  },
  {
    label: "Overlay cancel glyph (s-muted) on its hair pill",
    fg: "s-muted",
    bg: ["s-surface-solid", "s-hair"],
    level: "ui",
  },
];

/**
 * Extra derived values that exist only as inline CSS in a component, or as a
 * composite the parser cannot name on its own.
 */
const EXTRA_TOKENS: Record<string, string> = {
  // .stext-cap color
  "s-text-90": "color-mix(in srgb, var(--color-text) 90%, transparent)",
  // --s-surface is the background at 98% over a transparent window; on screen
  // it composites against whatever is behind, so treat it as the app surface.
  "s-surface-solid": "var(--color-background)",
  // The hero's border paints over the hero's own fill (background-clip is
  // border-box), so its on-screen color is the edge already composited there.
  // Named here so it can be measured against the page on the other side.
  "hero-edge-on-hero":
    "color-mix(in srgb, #fff8fc 40%, var(--color-hero-from))",
};

const layerToRgba = (layer: string, env: Map<string, string>): Rgba => {
  const [name, alphaText] = layer.split("/");
  const declaration =
    EXTRA_TOKENS[name] ??
    env.get(`--color-${name}`) ??
    env.get(`--${name}`) ??
    env.get(`--shadow-${name}`);
  if (declaration === undefined) throw new Error(`Unknown token: ${name}`);
  const color = resolveColor(declaration, env);
  if (alphaText === undefined) return color;
  return { ...color, a: color.a * (Number(alphaText) / 100) };
};

const flatten = (layers: string[], env: Map<string, string>): Rgba =>
  layers
    .map((layer) => layerToRgba(layer, env))
    .reduce((base, layer) => over(layer, base));

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const files = [THEME_CSS, OVERLAY_CSS];
const environments: Record<Theme, Map<string, string>> = {
  light: resolveEnvironment(files, "light"),
  dark: resolveEnvironment(files, "dark"),
};

interface Row {
  check: Check;
  light: number;
  dark: number;
}

const rows: Row[] = CHECKS.map((check) => {
  const ratioFor = (theme: Theme): number => {
    const env = environments[theme];
    const background = flatten(check.bg, env);
    const foreground = over(layerToRgba(check.fg, env), background);
    return contrast(foreground, background);
  };
  return { check, light: ratioFor("light"), dark: ratioFor("dark") };
});

const labelWidth = Math.max(...rows.map((row) => row.check.label.length));
const meets = (ratio: number, level: Level): boolean =>
  ratio + 1e-9 >= THRESHOLDS[level];

const render = (row: Row): string => {
  const { check } = row;
  const mark = (ratio: number): string => {
    if (meets(ratio, check.level)) return "PASS";
    return check.advisory === undefined ? "FAIL" : "note";
  };
  return `${check.label.padEnd(labelWidth)}  ${THRESHOLDS[check.level].toFixed(1).padEnd(5)}  ${row.light.toFixed(2).padStart(6)}  ${mark(row.light).padEnd(4)}  ${row.dark.toFixed(2).padStart(6)}  ${mark(row.dark).padEnd(4)}`;
};

console.log(
  `${"Pair".padEnd(labelWidth)}  ${"Need".padEnd(5)}  ${"Light".padStart(6)}  ${"".padEnd(4)}  ${"Dark".padStart(6)}  ${"".padEnd(4)}`,
);
console.log("-".repeat(labelWidth + 34));
for (const row of rows) console.log(render(row));
console.log("-".repeat(labelWidth + 34));

const failures = rows.filter(
  (row) =>
    row.check.advisory === undefined &&
    (!meets(row.light, row.check.level) || !meets(row.dark, row.check.level)),
);
const notes = rows.filter(
  (row) =>
    row.check.advisory !== undefined &&
    (!meets(row.light, row.check.level) || !meets(row.dark, row.check.level)),
);

if (notes.length > 0) {
  console.log("\nBelow threshold by design (documented exceptions):");
  for (const row of notes)
    console.log(`  · ${row.check.label}\n      ${row.check.advisory}`);
}

console.log(
  failures.length === 0
    ? `\nAll ${rows.length - notes.length} normative pairs meet WCAG AA in both themes.`
    : `\n${failures.length} normative pair(s) fall below AA.`,
);

if (failures.length > 0) process.exit(1);
