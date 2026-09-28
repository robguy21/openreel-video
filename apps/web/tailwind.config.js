/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // ── v2 editor tokens (cinematic, emerald)
        //   These read raw oklch via CSS variables. Opacity modifiers
        //   are not supported on these — use the *-soft / *-glow
        //   companion tokens (or arbitrary values) when you need a tint.
        bg: {
          DEFAULT: "var(--bg)",
          1: "var(--bg-1)",
          2: "var(--bg-2)",
          3: "var(--bg-3)",
          elev: "var(--bg-elev)",
        },
        fg: {
          DEFAULT: "var(--fg)",
          strong: "var(--fg-strong)",
          2: "var(--fg-2)",
          3: "var(--fg-3)",
          muted: "var(--fg-muted)",
        },
        "border-strong": "var(--border-strong)",
        hover: "var(--hover)",
        selected: "var(--selected)",
        "stage-bg": "var(--stage-bg)",
        "tl-bg": "var(--tl-bg)",
        "track-bg": "var(--track-bg)",
        waveform: "var(--waveform)",
        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft)",
          fg: "var(--accent-fg)",
          // shadcn primitives (Select/DropdownMenu/ContextMenu/Button) hover
          // with `bg-accent text-accent-foreground`; without this mapping the
          // text color resolved to nothing and disappeared on the emerald
          // hover background. Maps to the on-accent text token.
          foreground: "var(--accent-fg)",
          glow: "var(--accent-glow)",
          // accent text on glass, and the filled accent a primary button wears
          text: "var(--accent-text)",
          fill: "var(--accent-fill)",
        },
        // ── Clip Studio glass (docs/PROPOSAL_EDITOR_REDESIGN.md R1.1)
        glass: {
          DEFAULT: "var(--glass-fill)",
          border: "var(--glass-border)",
        },
        field: {
          DEFAULT: "var(--field-fill)",
          border: "var(--field-border)",
        },
        control: {
          DEFAULT: "var(--control-fill)",
          border: "var(--control-border)",
        },
        lit: "var(--lit)",
        capsule: "var(--capsule-fill)",
        clip: {
          video: "var(--c-video)",
          text: "var(--c-text)",
          audio: "var(--c-audio)",
          music: "var(--c-music)",
        },

        // ── shadcn / existing components (HSL with <alpha-value>) ──
        background: {
          DEFAULT: "hsl(var(--background))",
          secondary: "var(--bg-1)",
          tertiary: "var(--bg-2)",
          elevated: "var(--bg-elev)",
        },
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "var(--accent-strong)",
          active: "var(--accent-strong)",
          glow: "var(--accent-glow)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: {
          DEFAULT: "var(--border)",
          hover: "var(--border-strong)",
          active: "var(--border-strong)",
        },
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        text: {
          primary: "var(--fg)",
          secondary: "var(--fg-2)",
          muted: "var(--fg-3)",
        },
        status: {
          success: "var(--success)",
          warning: "var(--warning)",
          error: "var(--danger)",
          info: "var(--accent)",
        },
      },
      fontFamily: {
        sans: ["Geist", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "0 2px 8px var(--accent-glow)",
        "glow-lg": "0 4px 14px var(--accent-glow)",
        panel: "var(--shadow-md)",
        glass: "var(--glass-edge), var(--glass-shadow)",
        control: "var(--glass-edge-control)",
        field: "var(--glass-edge-field)",
        selected: "var(--ring-selected)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "0.75rem",
        "2xl": "1rem",
        // Clip Studio's radii, by the part they belong to (_radii.scss)
        card: "30px",
        frame: "20px",
        field: "18px",
        picture: "16px",
        tile: "14px",
        pill: "9999px",
      },
      spacing: {
        topbar: "var(--topbar-h)",
        toolnav: "var(--toolnav-h)",
        "tl-track": "var(--tl-track)",
        "tl-rail": "var(--tl-rail)",
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "1.3" }],
        "xs+": ["10.5px", { lineHeight: "1.35" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
