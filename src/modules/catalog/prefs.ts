// View preferences for the Catalog page, persisted per device.
// Deliberately localStorage (not the settings table): these are presentation
// choices that belong to this browser, not to the shop's shared data.

const KEY = "lubric_catalog_prefs";

export type ViewMode = "list" | "grid";
export type Density = "s" | "m" | "l";
export type EntityKey = "products" | "services" | "containers" | "used_oil";

export interface CatalogPrefs {
  view: ViewMode;
  density: Density;
  /** Only stores entities the user has explicitly customised. */
  columns: Partial<Record<EntityKey, string[]>>;
}

export const ENTITIES: { key: EntityKey; label: string; icon: string }[] = [
  { key: "products", label: "Products", icon: "◈" },
  { key: "services", label: "Services", icon: "◎" },
  { key: "containers", label: "Containers", icon: "◌" },
  { key: "used_oil", label: "Used Oil Drum", icon: "◔" },
];

export const DENSITY_LABEL: Record<Density, string> = { s: "S", m: "M", l: "L" };

const DEFAULTS: CatalogPrefs = { view: "list", density: "m", columns: {} };

export function loadPrefs(): CatalogPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, columns: {} };
    const p = JSON.parse(raw) as Partial<CatalogPrefs>;
    return {
      view: p.view === "grid" ? "grid" : "list",
      density: p.density === "s" || p.density === "l" ? p.density : "m",
      columns: p.columns && typeof p.columns === "object" ? p.columns : {},
    };
  } catch {
    return { ...DEFAULTS, columns: {} };
  }
}

export function savePrefs(p: CatalogPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — preferences simply won't persist */
  }
}

/** Row padding for list mode, driven by the density control. */
export function densityPad(d: Density): string {
  return d === "s" ? "0.3rem 0.6rem" : d === "l" ? "0.95rem 1rem" : "0.6rem 0.75rem";
}

/** Minimum card width for grid mode, driven by the density control. */
export function densityCardWidth(d: Density): number {
  return d === "s" ? 150 : d === "l" ? 290 : 215;
}