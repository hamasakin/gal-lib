import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  // 旧 milestone 用 darkMode: ["class"] + .dark；v1.1 改用 [data-theme] 多主题切换。
  // 保留 class 模式做向后兼容，组件层不再依赖 .dark；色值差异完全由 CSS 变量决定。
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // shadcn 兼容层 — 直接吃 CSS var（无 hsl 包裹）。color tokens 由 src/index.css
        // 的设计令牌驱动，所以 bg-background / text-foreground 等既有调用零改动。
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        // shadcn 的 "accent" 是 surface elevated（不是 brand 强调色）；保留旧语义。
        accent: {
          DEFAULT: "var(--shadcn-accent)",
          foreground: "var(--shadcn-accent-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },

        // gal-lib v1.1 设计令牌 — 直接当 Tailwind utility 使用，例如 bg-bg-1 / text-ink-2。
        "bg-0": "var(--bg-0)",
        "bg-1": "var(--bg-1)",
        "bg-2": "var(--bg-2)",
        "bg-3": "var(--bg-3)",
        "ink-0": "var(--ink-0)",
        "ink-1": "var(--ink-1)",
        "ink-2": "var(--ink-2)",
        "ink-3": "var(--ink-3)",
        "ink-stamp": "var(--ink-stamp)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        brand: {
          DEFAULT: "var(--accent)",
          deep: "var(--accent-deep)",
          soft: "var(--accent-soft)",
          on: "var(--accent-on)",
        },
      },
      borderRadius: {
        // 旧业务用 rounded-lg/md/sm；映射到设计的可变圆角。
        lg: "var(--r-lg)",
        md: "var(--r-md)",
        sm: "var(--r-sm)",
        xl: "var(--r-xl)",
      },
      fontFamily: {
        sans: ["var(--sans)"],
        serif: ["var(--serif)"],
        mono: ["var(--mono)"],
      },
      fontSize: {
        // UI-SPEC §Typography（v1.0 锁定，v1.1 沿用）
        body: ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        label: ["13px", { lineHeight: "1.4", fontWeight: "500" }],
        h2: ["18px", { lineHeight: "1.4", fontWeight: "600" }],
        h3: ["16px", { lineHeight: "1.4", fontWeight: "600" }],
        display: ["13px", { lineHeight: "1.0", fontWeight: "500" }],
      },
      aspectRatio: {
        cover: "3 / 4",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
      },
      keyframes: {
        "gallib-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 var(--accent)", opacity: "1" },
          "50%": { boxShadow: "0 0 0 6px transparent", opacity: "0.65" },
        },
      },
      animation: {
        "gallib-pulse": "gallib-pulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
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
