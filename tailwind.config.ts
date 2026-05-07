import type { Config } from "tailwindcss";

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
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
