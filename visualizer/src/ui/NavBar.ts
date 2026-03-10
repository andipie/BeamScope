/**
 * Navigation bar for switching between BeamScope pages.
 *
 * Renders a fixed top bar with links to:
 *   - Visualization (index.html / main page)
 *   - Scope (scope.html / time-series page)
 *
 * The active page link is highlighted.
 */
export function createNavBar(activePage: "visualization" | "scope"): HTMLElement {
  const nav = document.createElement("nav");
  nav.id = "navbar";

  const links: Array<{ label: string; href: string; page: "visualization" | "scope" }> = [
    { label: "Visualization", href: "/", page: "visualization" },
    { label: "Scope", href: "/scope.html", page: "scope" },
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
