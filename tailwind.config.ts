import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          '"Segoe UI"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
      },
      fontSize: {
        // UI-SPEC §Typography — 4-tier scale locked (P1)
        body: ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        label: ["13px", { lineHeight: "1.4", fontWeight: "500" }],
        h2: ["18px", { lineHeight: "1.4", fontWeight: "600" }],
        display: ["13px", { lineHeight: "1.0", fontWeight: "500" }],
        // 02-UI-SPEC §Typography — H3 added as 5th tier (P2)
        h3: ["16px", { lineHeight: "1.4", fontWeight: "600" }],
      },
      // 02-UI-SPEC §Game Card — 3:4 cover aspect ratio token (P2)
      aspectRatio: {
        cover: "3 / 4",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // shadcn 4.7 generates Tailwind v4-style data-attribute shorthand classes
    // (data-active:, data-open:, data-horizontal:, ...). This project pins
    // Tailwind v3 which only supports the long-form `data-[state=...]:`
    // syntax. Register the shorthand variants explicitly so the generated
    // shadcn classes actually apply — without this, e.g. `Tabs` falls back
    // to flex-row and renders TabsList beside (not above) TabsContent.
    plugin(({ addVariant }) => {
      addVariant("data-active", "&[data-state=active]");
      addVariant("data-inactive", "&[data-state=inactive]");
      addVariant("data-open", "&[data-state=open]");
      addVariant("data-closed", "&[data-state=closed]");
      addVariant("data-checked", "&[data-state=checked]");
      addVariant("data-unchecked", "&[data-state=unchecked]");
      addVariant("data-horizontal", "&[data-orientation=horizontal]");
      addVariant("data-vertical", "&[data-orientation=vertical]");
      addVariant("data-inset", "&[data-inset=true]");
      addVariant("data-disabled", "&[data-disabled]");
      addVariant("not-data-disabled", "&:not([data-disabled])");
    }),
  ],
} satisfies Config;
