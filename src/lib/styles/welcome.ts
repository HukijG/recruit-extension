// src/lib/styles/welcome.ts
//
// Shared welcome-hero styles used by both LoginScreen (unauthenticated
// state) and the post-not-on-pipeline greeting in sync.tsx. Extracted
// here so neither importer reaches across feature boundaries.

import type { CSSProperties } from "react"

export const welcomeStyles: Record<string, CSSProperties> = {
  greetingHero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: "10px",
    marginTop: "62px",
    padding: "0 12px",
    width: "100%",
    animation: "fade-up 0.35s ease-out"
  },
  wave: {
    fontSize: "40px",
    display: "inline-block",
    transformOrigin: "70% 70%",
    animation: "wave 2.6s ease-in-out infinite",
    marginBottom: "4px"
  },
  waveLarge: {
    fontSize: "56px"
  },
  welcomeTitle: {
    fontSize: "30px",
    fontWeight: 700,
    color: "#0d0d0d",
    margin: "4px 0 6px 0",
    lineHeight: 1.2,
    letterSpacing: "-0.025em",
    fontFamily:
      'ui-rounded, "SF Pro Rounded", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
  },
  welcomeAccent: {
    background: "linear-gradient(135deg, #0a66c2 0%, #2d8eff 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    fontWeight: 800
  },
  greetingBody: {
    fontSize: "13.5px",
    color: "#0e0d0d",
    lineHeight: 1.55,
    margin: "2px 0 0 0",
    maxWidth: "280px"
  },
  greetingEmphasis: {
    color: "#0d82f7",
    fontStyle: "normal",
    fontWeight: 600
  },
  greetingHint: {
    fontSize: "14px",
    color: "#2e2f30",
    margin: "14px 0 0 0",
    letterSpacing: "0.01em"
  }
}
