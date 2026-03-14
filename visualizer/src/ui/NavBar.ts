import { persistence } from "../core/persistence.js";

/**
 * Navigation bar for switching between BeamScope pages.
 *
 * Renders a fixed top bar with links to:
 *   - Visualization (index.html / main page)
 *   - Scope (scope.html / time-series page)
 *
 * The active page link is highlighted.
 * Config parameter (?config=...) is carried across pages.
 */
export function createNavBar(activePage: "visualization" | "scope"): HTMLElement {
  const nav = document.createElement("nav");
  nav.id = "navbar";

  // Carry ?config= parameter across pages via URL param or persisted config
  const urlConfig = new URLSearchParams(window.location.search).get("config");
  const savedConfig = persistence.getString("config");
  const configParam = urlConfig ?? savedConfig;
  const suffix = configParam ? `?config=${encodeURIComponent(configParam)}` : "";

  const links: Array<{ label: string; href: string; page: "visualization" | "scope" }> = [
    { label: "Visualization", href: `/${suffix}`, page: "visualization" },
    { label: "Scope", href: `/scope.html${suffix}`, page: "scope" },
  ];

  for (const link of links) {
    const a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.label;
    a.className = link.page === activePage ? "nav-link active" : "nav-link";
    nav.appendChild(a);
  }

  return nav;
}
