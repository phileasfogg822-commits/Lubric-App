import { useState, type ReactElement } from "react";
import { Page } from "../../components/Page";
import { COLUMNS, defaultKeys, visibleColumns, type Column } from "./columns";
import {
  ENTITIES, loadPrefs, savePrefs, type CatalogPrefs, type EntityKey, type ViewMode, type Density,
} from "./prefs";
import ProductPane from "./ProductPane";
import ServicePane from "./ServicePane";
import ContainerPane from "./ContainerPane";
import UsedOilPane from "./UsedOilPane";

const DENSITIES: Density[] = ["s", "m", "l"];

export default function Catalog() {
  const [prefs, setPrefs] = useState<CatalogPrefs>(loadPrefs);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<EntityKey | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerEntity, setPickerEntity] = useState<EntityKey>("products");

  function update(patch: Partial<CatalogPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(next);
  }

  function setView(v: ViewMode) { update({ view: v }); }
  function setDensity(d: Density) { update({ density: d }); }

  function toggleColumn(entity: EntityKey, key: string) {
    const base = prefs.columns[entity] ?? defaultKeys(entity);
    const next = base.includes(key)
      ? base.filter((k) => k !== key)
      : COLUMNS[entity].filter((c) => base.includes(c.key) || c.key === key).map((c) => c.key);
    update({ columns: { ...prefs.columns, [entity]: next } });
  }

  function resetColumns(entity: EntityKey) {
    const next = { ...prefs.columns };
    delete next[entity];
    update({ columns: next });
  }

  const cols = (e: EntityKey): Column[] => visibleColumns(e, prefs.columns[e]);
  const pickerCols = COLUMNS[pickerEntity];
  const pickerSelected = prefs.columns[pickerEntity] ?? defaultKeys(pickerEntity);

  const toolbar = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      <input
        className="input"
        placeholder="Search catalog…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ maxWidth: 260 }}
      />
      <div style={{ display: "flex", gap: 0 }}>
        <button className={`btn btn-sm ${prefs.view === "list" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("list")} style={{ borderRadius: "6px 0 0 6px" }}>☰ List</button>
        <button className={`btn btn-sm ${prefs.view === "grid" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("grid")} style={{ borderRadius: "0 6px 6px 0" }}>▦ Grid</button>
      </div>
      <div style={{ display: "flex", gap: 0 }}>
        {DENSITIES.map((d) => (
          <button
            key={d}
            className={`btn btn-sm ${prefs.density === d ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setDensity(d)}
            style={{ borderRadius: d === "s" ? "6px 0 0 6px" : d === "l" ? "0 6px 6px 0" : 0 }}
          >
            {d.toUpperCase()}
          </button>
        ))}
      </div>
      <button className={`btn btn-sm ${pickerOpen ? "btn-primary" : "btn-ghost"}`} onClick={() => setPickerOpen(!pickerOpen)}>Columns ▾</button>
      {expanded && (
        <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(null)}>← Show all sections</button>
      )}
    </div>
  );

  const picker = pickerOpen ? (
    <div className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            className={`btn btn-sm ${pickerEntity === e.key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setPickerEntity(e.key)}
          >
            {e.icon} {e.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => resetColumns(pickerEntity)}>Reset to defaults</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 4 }}>
        {pickerCols.map((c) => (
          <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", padding: "3px 4px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={pickerSelected.includes(c.key)}
              onChange={() => toggleColumn(pickerEntity, c.key)}
            />
            {c.label}
          </label>
        ))}
      </div>
    </div>
  ) : null;

  const paneProps = (e: EntityKey) => ({
    view: prefs.view,
    density: prefs.density,
    columns: cols(e),
    search,
    compact: expanded === null,
    onViewAll: () => setExpanded(e),
  });

  const panes: { key: EntityKey; el: ReactElement }[] = [
    { key: "products", el: <ProductPane {...paneProps("products")} /> },
    { key: "services", el: <ServicePane {...paneProps("services")} /> },
    { key: "containers", el: <ContainerPane {...paneProps("containers")} /> },
    { key: "used_oil", el: <UsedOilPane {...paneProps("used_oil")} /> },
  ];

  const shown = expanded ? panes.filter((p) => p.key === expanded) : panes;

  return (
    <Page title="Catalog" subtitle="Products, services, containers and used oil — all in one place">
      {toolbar}
      {picker}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: expanded ? "1fr" : "repeat(auto-fit, minmax(min(100%, 460px), 1fr))",
          gap: 24,
          alignItems: "start",
        }}
      >
        {shown.map((p) => (
          <div key={p.key} style={{ minWidth: 0 }}>{p.el}</div>
        ))}
      </div>
    </Page>
  );
}