/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary":                    "var(--color-primary)",
        "on-primary":                 "var(--color-on-primary)",
        "primary-container":          "var(--color-primary-container)",
        "on-primary-container":       "var(--color-on-primary-container)",
        "primary-fixed":              "var(--color-primary-fixed)",
        "primary-fixed-dim":          "var(--color-primary-fixed-dim)",
        "on-primary-fixed":           "var(--color-on-primary-fixed)",
        "on-primary-fixed-variant":   "var(--color-on-primary-fixed-variant)",
        
        "surface":                    "var(--color-surface)",
        "surface-dim":                "var(--color-surface-dim)",
        "surface-bright":             "var(--color-surface-bright)",
        "surface-container-lowest":   "var(--color-surface-container-lowest)",
        "surface-container-low":      "var(--color-surface-container-low)",
        "surface-container":          "var(--color-surface-container)",
        "surface-container-high":     "var(--color-surface-container-high)",
        "surface-container-highest":  "var(--color-surface-container-highest)",
        "on-surface":                 "var(--color-on-surface)",
        "on-surface-variant":         "var(--color-on-surface-variant)",
        
        "background":                 "var(--color-background)",
        "on-background":              "var(--color-on-background)",
        
        "outline":                    "var(--color-outline)",
        "outline-variant":            "var(--color-outline-variant)",
        
        "secondary":                  "var(--color-secondary)",
        "on-secondary":               "var(--color-on-secondary)",
        "secondary-container":        "var(--color-secondary-container)",
        "on-secondary-container":     "var(--color-on-secondary-container)",
        "secondary-fixed":            "var(--color-secondary-fixed)",
        "secondary-fixed-dim":        "var(--color-secondary-fixed-dim)",
        "on-secondary-fixed":         "var(--color-on-secondary-fixed)",
        "on-secondary-fixed-variant": "var(--color-on-secondary-fixed-variant)",
        
        "tertiary":                   "var(--color-tertiary)",
        "on-tertiary":                "var(--color-on-tertiary)",
        "tertiary-container":         "var(--color-tertiary-container)",
        "on-tertiary-container":      "var(--color-on-tertiary-container)",
        "tertiary-fixed":             "var(--color-tertiary-fixed)",
        "tertiary-fixed-dim":         "var(--color-tertiary-fixed-dim)",
        "on-tertiary-fixed":          "var(--color-on-tertiary-fixed)",
        "on-tertiary-fixed-variant":  "var(--color-on-tertiary-fixed-variant)",

        "error":                      "var(--color-error)",
        "on-error":                   "var(--color-on-error)",
        "error-container":            "var(--color-error-container)",
        "on-error-container":         "var(--color-on-error-container)",
        
        "inverse-surface":            "var(--color-inverse-surface)",
        "inverse-on-surface":         "var(--color-inverse-on-surface)",
        "inverse-primary":            "var(--color-inverse-primary)",
        
        "surface-tint":               "var(--color-surface-tint)",
      },
      borderRadius: {
        "DEFAULT": "0.125rem",
        "sm":  "0.25rem",
        "md":  "0.375rem",
        "lg":  "0.5rem",
        "xl":  "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        "full": "9999px",
      },
      fontFamily: {
        "headline": ["Noto Serif", "serif"],
        "body":     ["Manrope", "sans-serif"],
        "label":    ["Manrope", "sans-serif"],
        "noto":     ["Noto Serif", "serif"],
        "manrope":  ["Manrope", "sans-serif"],
      },
      boxShadow: {
        "luxury":       "0 10px 30px -15px rgba(0,0,0,0.05)",
        "luxury-md":    "0 10px 40px -10px rgba(0,0,0,0.08)",
        "luxury-dark":  "0px 20px 40px rgba(0,0,0,0.4)",
        "glass-top":    "0px -10px 30px rgba(0,0,0,0.5)",
        "kds-urgent":   "0px 10px 20px rgba(147,0,10,0.1)",
        "primary-glow": "0 0 15px var(--color-primary)",
      },
      animation: {
        "pulse-glow":    "pulse-glow 2s ease-in-out infinite",
        "slide-in-right":"slideInRight 0.3s ease",
        "float":         "float 3s ease-in-out infinite",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { "box-shadow": "0 0 8px var(--color-primary)" },
          "50%":       { "box-shadow": "0 0 20px var(--color-primary)" },
        },
        "slideInRight": {
          "from": { opacity: "0", transform: "translateX(20px)" },
          "to":   { opacity: "1", transform: "translateX(0)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%":       { transform: "translateY(-8px)" },
        },
      },
    },
  },
  safelist: [
    // KDS urgency borders
    "order-card-border-new",
    "order-card-border-prep",
    "order-card-border-ready",
    "order-card-border-served",
    "order-card-border-urgent",
    // Animation utilities
    "animate-pulse-glow",
    "animate-float",
    // Admin utilities
    "log-terminal",
    "luxury-shadow",
    "luxury-shadow-md",
  ],
  plugins: [],
}
