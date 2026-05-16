const API_BASE = new URLSearchParams(window.location.search).get("api")?.replace(/\/$/, "") || "";

const API = {
  status: `${API_BASE}/api/status`,
  schema: `${API_BASE}/api/schema`,
  shots: `${API_BASE}/api/shots`,
  next: `${API_BASE}/api/next`,
  shot: (clock) => `${API_BASE}/api/shots/${clock}`,
  visualizer: (clock) => `${API_BASE}/api/shots/${clock}/visualizer`,
  values: (field) => `${API_BASE}/api/fields/${encodeURIComponent(field)}/values`,
};

const DEFAULT_SCHEMA = [
  { key: "bean_brand", name: "Beans roaster", short_name: "Roaster", section: "beans", data_type: "category" },
  { key: "bean_type", name: "Beans type", short_name: "Beans", section: "beans", data_type: "category" },
  { key: "roast_date", name: "Roast date", short_name: "Roasted", section: "beans", data_type: "text" },
  { key: "roast_level", name: "Roast level", short_name: "Roast", section: "beans", data_type: "category" },
  { key: "bean_notes", name: "Beans notes", short_name: "Notes", section: "beans", data_type: "long_text" },
  { key: "grinder_model", name: "Grinder model", short_name: "Grinder", section: "equipment", data_type: "category" },
  { key: "grinder_setting", name: "Grinder setting", short_name: "Setting", section: "equipment", data_type: "category" },
  { key: "grinder_dose_weight", name: "Dose weight", short_name: "Dose", section: "extraction", data_type: "number", measure_unit: "g" },
  { key: "drink_weight", name: "Drink weight", short_name: "Yield", section: "extraction", data_type: "number", measure_unit: "g" },
  { key: "drink_tds", name: "Total Dissolved Solids", short_name: "TDS", section: "extraction", data_type: "number", measure_unit: "%" },
  { key: "drink_ey", name: "Extraction Yield", short_name: "EY", section: "extraction", data_type: "number", measure_unit: "%" },
  { key: "espresso_enjoyment", name: "Enjoyment", short_name: "Enjoyment", section: "tasting", data_type: "number" },
  { key: "espresso_notes", name: "Espresso note", short_name: "Note", section: "tasting", data_type: "long_text" },
  { key: "my_name", name: "Barista", short_name: "Barista", section: "people", data_type: "category" },
  { key: "drinker_name", name: "Drinker", short_name: "Drinker", section: "people", data_type: "category" },
];

const DEMO_SHOTS = [
  {
    clock: 1778932200,
    filename: "20260516T091000",
    iso_time: "2026-05-16T09:10:00+0300",
    profile_title: "Rao Allonge",
    bean_brand: "Kawa",
    bean_type: "Colombia El Diviso",
    bean_desc: "Kawa Colombia El Diviso",
    grinder_model: "Zerno Z1",
    grinder_setting: "4.2",
    grinder_dose_weight: 18,
    drink_weight: 54.2,
    extraction_time: 28.4,
    ratio: 3.01,
    drink_tds: 6.7,
    drink_ey: 20.1,
    espresso_enjoyment: 86,
    espresso_notes: "Sweet citrus, clean finish.",
  },
  {
    clock: 1778847600,
    filename: "20260515T094000",
    iso_time: "2026-05-15T09:40:00+0300",
    profile_title: "Adaptive",
    bean_brand: "Friedhats",
    bean_type: "Ethiopia Guji",
    bean_desc: "Friedhats Ethiopia Guji",
    grinder_model: "Lagom 01",
    grinder_setting: "1.7",
    grinder_dose_weight: 18.5,
    drink_weight: 42,
    extraction_time: 31.2,
    ratio: 2.27,
    drink_tds: 8.4,
    drink_ey: 19.1,
    espresso_enjoyment: 79,
    espresso_notes: "Floral but a little drying.",
  },
];

const DEMO_SERIES = {
  elapsed: Array.from({ length: 80 }, (_, i) => Number((i * 0.4).toFixed(1))),
  pressure: Array.from({ length: 80 }, (_, i) => Number((Math.min(8.8, Math.max(0, i * 0.32)) - Math.max(0, i - 45) * 0.07).toFixed(2))),
  flow: Array.from({ length: 80 }, (_, i) => Number((i < 15 ? i * 0.12 : 2.2 + Math.sin(i / 8) * 0.35).toFixed(2))),
  weight: Array.from({ length: 80 }, (_, i) => Number((Math.max(0, i - 18) * 0.82).toFixed(1))),
  temperature_basket: Array.from({ length: 80 }, (_, i) => Number((91 + Math.sin(i / 12) * 1.2).toFixed(1))),
};

const state = {
  mode: "history",
  schema: DEFAULT_SCHEMA,
  shots: [],
  selectedClock: null,
  selectedDetail: null,
  categoryValues: new Map(),
  originalValues: new Map(),
  dirtyValues: new Map(),
  visualizerSync: true,
  visualizerStatus: "",
  mobileView: "list",
  demo: false,
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  historyTab: document.querySelector("#historyTab"),
  nextTab: document.querySelector("#nextTab"),
  searchInput: document.querySelector("#searchInput"),
  shotCount: document.querySelector("#shotCount"),
  connectionState: document.querySelector("#connectionState"),
  shotList: document.querySelector("#shotList"),
  selectedDate: document.querySelector("#selectedDate"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedSubtitle: document.querySelector("#selectedSubtitle"),
  metricsStrip: document.querySelector("#metricsStrip"),
  metadataGrid: document.querySelector("#metadataGrid"),
  shotChart: document.querySelector("#shotChart"),
  chartLegend: document.querySelector("#chartLegend"),
  backToShotsButton: document.querySelector("#backToShotsButton"),
  editButton: document.querySelector("#editButton"),
};

const mobileQuery = window.matchMedia("(max-width: 900px)");

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return value;
  let text = value.trim();
  if (text === "{}" || text.toUpperCase() === "NULL") return "";
  if (text.length >= 2 && text.startsWith("{") && text.endsWith("}") && hasSingleOuterBracePair(text)) {
    text = text.slice(1, -1);
  }
  return text.replace(/\\n/g, "\n").trim();
}

function hasSingleOuterBracePair(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{" && text[i - 1] !== "\\") depth += 1;
    if (char === "}" && text[i - 1] !== "\\") depth -= 1;
    if (depth === 0 && i < text.length - 1) return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function normalizeSchema(fields) {
  return fields.map((field) => {
    const normalized = { ...field };
    for (const key of ["name", "short_name", "section", "subsection", "data_type", "default", "measure_unit"]) {
      normalized[key] = cleanValue(normalized[key]);
    }
    normalized.section = normalized.section || "description";
    normalized.name = normalized.name || titleFromKey(normalized.key);
    normalized.short_name = normalized.short_name || normalized.name;
    return normalized;
  });
}

function normalizeShot(shot) {
  const normalized = { ...shot };
  for (const [key, value] of Object.entries(normalized)) {
    normalized[key] = cleanValue(value);
  }
  return normalized;
}

function normalizeDetail(data) {
  return {
    ...data,
    shot: normalizeShot(data.shot || {}),
    fields: (data.fields || []).map((field) => ({
      ...field,
      name: cleanValue(field.name),
      value: cleanValue(field.value),
    })),
  };
}

function titleFromKey(key = "") {
  return String(key)
    .replace(/^next_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function fieldLabel(field) {
  return cleanValue(field.short_name) || cleanValue(field.name) || titleFromKey(field.key);
}

function fmt(value, digits = 1) {
  const cleaned = cleanValue(value);
  if (cleaned === null || cleaned === undefined || cleaned === "") return "-";
  if (cleaned === "null" || cleaned === "NULL") return "-";
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return String(cleaned);
  return number.toFixed(digits).replace(/\.0$/, "");
}

function shotTitle(shot) {
  const beans = [shot.bean_brand, shot.bean_type].map(cleanValue).filter(Boolean).join(" ");
  return beans || cleanValue(shot.profile_title) || cleanValue(shot.filename) || "Shot";
}

function shotSubtitle(shot) {
  const profile = cleanValue(shot.profile_title) || "No profile";
  const date = shot.iso_time ? new Date(shot.iso_time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  return [profile, date].filter(Boolean).join(" @ ");
}

function metricText(shot) {
  const dose = fmt(shot.grinder_dose_weight);
  const drink = fmt(shot.drink_weight);
  const ratio = shot.ratio ? `1:${fmt(shot.ratio, 2)}` : ratioFromShot(shot);
  const seconds = fmt(shot.extraction_time);
  return `${dose}g -> ${drink}g (${ratio}) in ${seconds}s`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const json = await response.json();
  if (!response.ok || json.ok === false) {
    throw new Error(json.error || `Request failed: ${response.status}`);
  }
  return json;
}

function isMobileLayout() {
  return mobileQuery.matches;
}

function routeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    shot: cleanValue(params.get("shot")),
    view: cleanValue(params.get("view")),
  };
}

function writeRoute(changes = {}, options = {}) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const stateObj = {
    shot: url.searchParams.get("shot") || "",
    view: url.searchParams.get("view") || "",
  };
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method](stateObj, "", url);
}

function setModeChrome(mode) {
  state.mode = mode;
  els.historyTab.classList.toggle("active", mode === "history");
  els.nextTab.classList.toggle("active", mode === "next");
  els.historyTab.setAttribute("aria-selected", mode === "history" ? "true" : "false");
  els.nextTab.setAttribute("aria-selected", mode === "next" ? "true" : "false");
  els.searchInput.disabled = mode !== "history";
}

function setMobileView(view, options = {}) {
  state.mobileView = view;
  applyResponsiveView();
  if (isMobileLayout() && options.scroll !== false) {
    window.scrollTo({ top: 0, behavior: options.instant ? "auto" : "smooth" });
  }
  if (view === "detail" && state.selectedDetail) {
    requestAnimationFrame(() => drawChart(state.selectedDetail.series || {}));
  }
}

function applyResponsiveView() {
  const mobile = isMobileLayout();
  const detail = state.mobileView === "detail" || state.mode === "next";
  document.body.classList.toggle("mobile-list-view", mobile && !detail);
  document.body.classList.toggle("mobile-detail-view", mobile && detail);
  els.backToShotsButton.hidden = !(mobile && state.mode === "history" && detail);
}

async function selectFirstShotForWideLayout() {
  if (!isMobileLayout() && state.mode === "history" && !state.selectedDetail && state.shots.length) {
    await selectShot(state.selectedClock || state.shots[0].clock, { showDetail: false });
  }
}

async function applyRoute(options = {}) {
  const route = routeFromUrl();
  if (route.view === "next") {
    setMode("next", { updateUrl: false });
    return;
  }

  setModeChrome("history");
  if (route.shot) {
    if (!state.shots.length) {
      await loadShots();
      return;
    }
    await selectShot(route.shot, { showDetail: true, updateUrl: false, instant: options.instant });
    return;
  }

  state.selectedClock = null;
  renderShotList();
  renderEmptyDetail();
  setMobileView("list", { instant: options.instant, scroll: options.scroll });
}

async function loadApp() {
  window.history.replaceState(routeFromUrl(), "", window.location.href);
  applyResponsiveView();
  try {
    const [status, schema] = await Promise.all([fetchJson(API.status), fetchJson(API.schema)]);
    state.demo = false;
    state.schema = normalizeSchema(schema.fields?.length ? schema.fields : DEFAULT_SCHEMA);
    els.connectionState.textContent = `${status.shots ?? 0} in SDB`;
    await loadShots();
  } catch (error) {
    state.demo = true;
    state.schema = normalizeSchema(DEFAULT_SCHEMA);
    state.shots = DEMO_SHOTS.map(normalizeShot);
    els.connectionState.textContent = "Preview data";
    renderShotList();
    const route = routeFromUrl();
    if (route.shot) {
      await selectShot(route.shot, { showDetail: true, updateUrl: false, instant: true });
    } else if (isMobileLayout()) {
      renderEmptyDetail();
    } else {
      await selectShot(DEMO_SHOTS[0].clock, { showDetail: false });
    }
  }
}

async function loadShots() {
  if (state.mode !== "history") {
    await loadNext();
    return;
  }
  if (state.demo) {
    const needle = els.searchInput.value.trim().toLowerCase();
    state.shots = needle
      ? DEMO_SHOTS.filter((shot) => JSON.stringify(shot).toLowerCase().includes(needle))
      : DEMO_SHOTS;
    renderShotList();
    const route = routeFromUrl();
    if (state.shots.length && route.shot) {
      await selectShot(route.shot, { showDetail: true, updateUrl: false });
    } else if (state.shots.length && (!isMobileLayout() || state.mobileView === "detail")) {
      await selectShot(state.selectedClock || state.shots[0].clock, { showDetail: state.mobileView === "detail", updateUrl: false });
    } else {
      renderEmptyDetail();
    }
    return;
  }
  const params = new URLSearchParams({ limit: "500" });
  const search = els.searchInput.value.trim();
  if (search) params.set("search", search);
  const data = await fetchJson(`${API.shots}?${params}`);
  state.shots = (data.shots || []).map(normalizeShot);
  renderShotList();
  if (state.shots.length) {
    const route = routeFromUrl();
    const routeClock = route.shot && state.shots.some((shot) => String(shot.clock) === String(route.shot)) ? route.shot : "";
    const selectedStillVisible = state.selectedClock && state.shots.some((shot) => shot.clock === state.selectedClock);
    const clock = routeClock || (selectedStillVisible ? state.selectedClock : state.shots[0].clock);
    if (routeClock) {
      await selectShot(routeClock, { showDetail: true, updateUrl: false, instant: true });
    } else if (isMobileLayout() && state.mobileView === "list") {
      renderEmptyDetail();
    } else {
      await selectShot(clock, { showDetail: state.mobileView === "detail", updateUrl: false });
    }
  } else {
    renderEmptyDetail();
  }
}

async function loadNext() {
  state.visualizerStatus = "";
  els.shotList.innerHTML = `<div class="empty-state">Next Shot plan</div>`;
  els.shotCount.textContent = "Next Shot";
  const data = await fetchJson(API.next);
  state.selectedClock = "next";
  state.selectedDetail = normalizeDetail(data);
  renderDetail(state.selectedDetail);
  setMobileView("detail", { instant: true, scroll: false });
}

function renderShotList() {
  els.shotCount.textContent = `${state.shots.length} shot${state.shots.length === 1 ? "" : "s"}`;
  els.shotList.innerHTML = "";
  if (!state.shots.length) {
    els.shotList.innerHTML = `<div class="empty-state">No shots found</div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const shot of state.shots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `shot-card ${String(shot.clock) === String(state.selectedClock) ? "active" : ""}`;
    button.innerHTML = `
      <div class="shot-card-title">${escapeHtml(shotTitle(shot))}</div>
      <div class="shot-card-subtitle">${escapeHtml(shotSubtitle(shot))}</div>
      <div class="shot-card-meta">
        <span class="pill">${escapeHtml(metricText(shot))}</span>
        ${shot.grinder_setting ? `<span class="pill">${escapeHtml(shot.grinder_setting)} grind</span>` : ""}
        ${shot.espresso_enjoyment ? `<span class="pill">${escapeHtml(fmt(shot.espresso_enjoyment, 0))}/100</span>` : ""}
      </div>
    `;
    button.addEventListener("click", () => selectShot(shot.clock, { updateUrl: true }));
    fragment.append(button);
  }
  els.shotList.append(fragment);
}

async function selectShot(clock, options = {}) {
  state.selectedClock = clock;
  state.visualizerStatus = "";
  renderShotList();
  let data;
  if (state.demo) {
    const shot = DEMO_SHOTS.find((item) => item.clock === clock) || DEMO_SHOTS[0];
    data = {
      ok: true,
      shot: normalizeShot(shot),
      fields: state.schema.map((field) => ({ name: field.key, value: cleanValue(shot[field.key] ?? "") })),
      series: DEMO_SERIES,
    };
  } else {
    data = await fetchJson(API.shot(clock));
  }
  state.selectedDetail = normalizeDetail(data);
  renderDetail(state.selectedDetail);
  if (state.mode === "history" && options.updateUrl) {
    writeRoute({ shot: clock, view: null });
  }
  if (state.mode === "history" && isMobileLayout() && options.showDetail !== false) {
    setMobileView("detail", { instant: options.instant });
  }
}

function renderEmptyDetail() {
  state.selectedDetail = null;
  state.visualizerStatus = "";
  els.selectedDate.textContent = "No shots";
  els.selectedTitle.textContent = "Shot history";
  els.selectedSubtitle.textContent = "No matching shots were found.";
  els.metricsStrip.innerHTML = "";
  els.metadataGrid.innerHTML = "";
  clearChart();
}

function renderDetail(data) {
  const shot = data.shot || {};
  const fields = normalizeFields(data.fields || []);
  els.selectedDate.textContent = shot.kind === "next"
    ? "Next Shot"
    : shot.iso_time ? new Date(shot.iso_time).toLocaleString([], { dateStyle: "full", timeStyle: "short" }) : "Shot";
  els.selectedTitle.textContent = shotTitle(shot);
  els.selectedSubtitle.textContent = shot.kind === "next" ? "Plan and description values for the next espresso." : metricText(shot);
  renderMetrics(shot);
  renderMetadata(fields);
  drawChart(data.series || {});
}

function renderMetrics(shot) {
  const metrics = [
    ["Dose", `${fmt(shot.grinder_dose_weight)}g`],
    ["Yield", `${fmt(shot.drink_weight)}g`],
    ["Ratio", shot.ratio ? `1:${fmt(shot.ratio, 2)}` : ratioFromShot(shot)],
    ["Time", `${fmt(shot.extraction_time)}s`],
    ["Enjoyment", shot.espresso_enjoyment ? `${fmt(shot.espresso_enjoyment, 0)}/100` : "-"],
  ];
  els.metricsStrip.innerHTML = metrics.map(([label, value]) => `
    <div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("");
}

function ratioFromShot(shot) {
  const dose = Number(shot.grinder_dose_weight);
  const drink = Number(shot.drink_weight);
  return dose > 0 && drink > 0 ? `1:${fmt(drink / dose, 2)}` : "-";
}

function normalizeFields(fields) {
  const values = new Map(fields.map((field) => [cleanValue(field.name), cleanValue(field.value)]));
  const schemaKeys = new Set(state.schema.map((field) => field.key));
  const normalized = state.schema.map((field) => ({ ...field, value: values.get(field.key) ?? "" }));
  for (const field of fields) {
    const key = cleanValue(field.name);
    if (!key || schemaKeys.has(key)) continue;
    normalized.push({
      key,
      name: titleFromKey(key),
      short_name: titleFromKey(key),
      section: "description",
      data_type: inferFieldType(key, field.value),
      value: cleanValue(field.value),
    });
  }
  for (const field of normalized) {
    if (isVisualizerLinkField(field)) {
      field.name = "Visualizer";
      field.short_name = "Visualizer";
      field.section = "links";
    }
  }
  return normalized;
}

function renderMetadata(fields) {
  const groups = groupFields(fields);
  els.metadataGrid.innerHTML = "";
  state.originalValues = new Map(fields.map((field) => [field.key, cleanValue(field.value)]));
  state.dirtyValues.clear();
  for (const [section, items] of groups) {
    const block = document.createElement("section");
    block.className = "metadata-section";
    block.innerHTML = `<h3>${escapeHtml(sectionLabel(section))}</h3>`;
    const list = document.createElement("div");
    list.className = "field-list";
    for (const field of items) {
      list.append(isVisualizerLinkField(field) ? renderVisualizerLinkField(field) : renderInlineField(field));
    }
    block.append(list);
    els.metadataGrid.append(block);
  }
  updateSaveButton();
}

function inferFieldType(key, value) {
  if (["grinder_dose_weight", "drink_weight", "drink_tds", "drink_ey", "espresso_enjoyment"].includes(key)) return "number";
  if (String(cleanValue(value)).length > 80 || key.includes("notes") || key.includes("links")) return "long_text";
  return "text";
}

function isVisualizerLinkField(field) {
  const key = cleanValue(field.key);
  const value = cleanValue(field.value);
  return isVisualizerKey(key) || (key === "repository_links" && /visualizer\.coffee/i.test(value));
}

function isVisualizerKey(key) {
  const cleaned = cleanValue(key).toLowerCase();
  return cleaned === "visualizer_link" || cleaned.includes("visualizer");
}

function renderVisualizerLinkField(field) {
  const wrap = document.createElement("div");
  wrap.className = "inline-field link-field";
  wrap.dataset.fieldKey = field.key;

  const label = document.createElement("div");
  label.className = "field-label";
  label.textContent = "Visualizer";
  wrap.append(label);

  const url = extractUrl(field.value);
  if (url) {
    const link = document.createElement("a");
    link.className = "inline-link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open in visualizer.coffee";
    wrap.append(link);

    const meta = document.createElement("div");
    meta.className = "inline-field-meta";
    const urlText = document.createElement("span");
    urlText.textContent = url;
    meta.append(urlText);
    wrap.append(meta);

    if (state.mode === "history") {
      const sync = document.createElement("label");
      sync.className = "visualizer-sync";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.visualizerSync;
      checkbox.addEventListener("change", () => {
        state.visualizerSync = checkbox.checked;
        state.visualizerStatus = checkbox.checked ? "" : "Visualizer sync is off";
        updateVisualizerStatus();
      });
      const syncText = document.createElement("span");
      syncText.textContent = "Sync edits to Visualizer";
      sync.append(checkbox, syncText);
      wrap.append(sync);

      const status = document.createElement("div");
      status.className = "visualizer-sync-status";
      status.textContent = state.visualizerStatus;
      wrap.append(status);
    }
  } else {
    const empty = document.createElement("div");
    empty.className = "read-only-value";
    empty.textContent = "-";
    wrap.append(empty);
  }
  return wrap;
}

function hasVisualizerLink(detail = state.selectedDetail) {
  if (!detail) return false;
  const fields = normalizeFields(detail.fields || []);
  return fields.some((field) => isVisualizerLinkField(field) && extractUrl(field.value));
}

function updateVisualizerStatus() {
  const status = document.querySelector(".visualizer-sync-status");
  if (status) status.textContent = state.visualizerStatus;
}

function extractUrl(value) {
  const match = String(cleanValue(value)).match(/https?:\/\/[^\s}]+/i);
  return match ? match[0] : "";
}

function renderInlineField(field) {
  const wrap = document.createElement("div");
  wrap.className = `inline-field ${field.data_type === "number" ? "inline-field-number" : ""}`;
  wrap.dataset.fieldKey = field.key;

  const label = document.createElement("label");
  label.setAttribute("for", `inline-${field.key}`);
  label.textContent = fieldLabel(field);
  wrap.append(label);

  const input = createFieldInput(field, `inline-${field.key}`);
  input.classList.add("inline-input");
  input.addEventListener("input", () => markDirty(field, input.value, input));
  input.addEventListener("change", () => markDirty(field, input.value, input));

  if (field.data_type === "number") {
    const control = document.createElement("div");
    control.className = "number-control";
    const decrement = stepButton("-", `Decrease ${fieldLabel(field)}`, () => {
      adjustNumber(input, field, -1);
      markDirty(field, input.value, input);
    });
    const increment = stepButton("+", `Increase ${fieldLabel(field)}`, () => {
      adjustNumber(input, field, 1);
      markDirty(field, input.value, input);
    });
    control.append(decrement, input, increment);
    wrap.append(control);
  } else {
    wrap.append(input);
  }

  const meta = document.createElement("div");
  meta.className = "inline-field-meta";
  const unit = cleanValue(field.measure_unit);
  const hint = document.createElement("span");
  hint.textContent = unit ? unit : titleFromKey(field.key);
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear";
  clear.addEventListener("click", () => {
    input.value = "";
    markDirty(field, input.value, input);
    input.focus();
  });
  meta.append(hint, clear);
  wrap.append(meta);
  return wrap;
}

function createFieldInput(field, id) {
  let input;
  if (field.data_type === "long_text" || field.data_type === "complex") {
    input = document.createElement("textarea");
  } else {
    input = document.createElement("input");
    input.type = field.data_type === "number" ? "number" : "text";
    if (field.data_type === "number") {
      input.inputMode = "decimal";
      if (field.min !== null && field.min !== undefined) input.min = field.min;
      if (field.max !== null && field.max !== undefined) input.max = field.max;
      input.step = field.smallincrement || "any";
    }
    if (field.data_type === "category") {
      const listId = `${id}-values`;
      input.setAttribute("list", listId);
      input.addEventListener("focus", () => hydrateDatalist(field.key, listId, input));
    }
  }
  input.id = id;
  input.name = field.key;
  input.dataset.type = field.data_type || "text";
  input.value = cleanValue(field.value);
  return input;
}

async function hydrateDatalist(field, listId, input) {
  if (document.getElementById(listId)) return;
  const datalist = document.createElement("datalist");
  datalist.id = listId;
  datalist.innerHTML = (await getCategoryValues(field))
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");
  input.after(datalist);
}

function stepButton(text, label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "step-button";
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", action);
  return button;
}

function markDirty(field, value, input) {
  const cleaned = cleanValue(value);
  const original = state.originalValues.get(field.key) ?? "";
  if (String(cleaned) === String(original)) {
    state.dirtyValues.delete(field.key);
    input.closest(".inline-field")?.classList.remove("dirty");
  } else {
    state.dirtyValues.set(field.key, {
      type: field.data_type || "text",
      value: cleaned,
    });
    input.closest(".inline-field")?.classList.add("dirty");
  }
  updateSaveButton();
}

function updateSaveButton() {
  const count = state.dirtyValues.size;
  els.editButton.textContent = count ? `Save ${count} change${count === 1 ? "" : "s"}` : "Saved";
  els.editButton.disabled = count === 0;
}

function groupFields(fields) {
  const order = ["links", "beans", "equipment", "extraction", "tasting", "people", "beverage", "description"];
  const map = new Map();
  for (const field of fields) {
    const section = cleanValue(field.section) || "description";
    if (!map.has(section)) map.set(section, []);
    map.get(section).push(field);
  }
  return [...map.entries()].sort((a, b) => {
    const ai = order.includes(a[0]) ? order.indexOf(a[0]) : order.length;
    const bi = order.includes(b[0]) ? order.indexOf(b[0]) : order.length;
    return ai - bi || a[0].localeCompare(b[0]);
  });
}

function sectionLabel(section) {
  const cleaned = cleanValue(section);
  const labels = {
    beans: "Beans",
    equipment: "Equipment",
    extraction: "Extraction",
    tasting: "Tasting",
    people: "People",
    beverage: "Beverage",
    links: "Links",
    description: "Description",
  };
  return labels[cleaned] || cleaned.replace(/_/g, " ");
}

function displayFieldValue(field) {
  const value = cleanValue(field.value);
  if (value === null || value === undefined || value === "") return "-";
  const unit = cleanValue(field.measure_unit) || "";
  if (field.data_type === "number") {
    const digits = Number.isFinite(Number(field.n_decimals)) ? Number(field.n_decimals) : 1;
    return `${fmt(value, digits)}${unit}`;
  }
  return String(value);
}

function drawChart(series) {
  const canvas = els.shotChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const elapsed = numericArray(series.elapsed);
  if (!elapsed.length) {
    clearChart("No graph data saved for this shot");
    return;
  }

  const lines = [
    { key: "pressure", label: "Pressure", color: "#087f8c", scale: "left" },
    { key: "flow", label: "Flow", color: "#c8553d", scale: "left" },
    { key: "weight", label: "Weight", color: "#6d5bd0", scale: "right" },
    { key: "temperature_basket", label: "Temp", color: "#a97818", scale: "temp" },
  ].map((line) => ({
    ...line,
    values: numericArray(series[line.key], { nonNegative: line.scale !== "temp" }),
  })).filter((line) => line.values.length);

  const pad = { left: 42, right: 42, top: 22, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xMax = Math.max(...elapsed);
  const domains = {
    left: chartDomain(lines, "left", { fallbackMax: 10, floorZero: true, minRange: 10 }),
    right: chartDomain(lines, "right", { fallbackMax: 50, floorZero: true, minRange: 50 }),
    temp: chartDomain(lines, "temp", { fallbackMin: 80, fallbackMax: 100, padding: 1.5, minRange: 10 }),
  };

  ctx.fillStyle = "#fbfcfd";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d9e2e6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH / 4) * i;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
  }
  ctx.stroke();

  ctx.fillStyle = "#65727a";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("0s", pad.left, height - 12);
  ctx.fillText(`${fmt(xMax, 0)}s`, width - pad.right - 28, height - 12);
  ctx.fillText(`${fmt(domains.left.max, 0)}`, 6, pad.top + 4);
  ctx.fillText(`${fmt(domains.left.min, 0)}`, 6, pad.top + plotH);
  ctx.textAlign = "right";
  ctx.fillText(`${fmt(domains.temp.max, 0)}C`, width - 6, pad.top + 4);
  ctx.fillText(`${fmt(domains.temp.min, 0)}C`, width - 6, pad.top + plotH);
  ctx.textAlign = "left";

  function xAt(index) {
    return pad.left + ((elapsed[index] || 0) / Math.max(1, xMax)) * plotW;
  }
  function yAt(value, scale) {
    const domain = domains[scale] || domains.left;
    const y = pad.top + plotH - ((value - domain.min) / (domain.max - domain.min)) * plotH;
    return clamp(y, pad.top, pad.top + plotH);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();
  for (const line of lines) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const length = Math.min(elapsed.length, line.values.length);
    for (let i = 0; i < length; i += 1) {
      const x = xAt(i);
      const y = yAt(line.values[i], line.scale);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  els.chartLegend.innerHTML = lines.map((line) => `
    <span class="legend-item" style="color:${line.color}">
      <span class="legend-swatch"></span>${escapeHtml(line.label)}
    </span>
  `).join("");
}

function clearChart(message = "") {
  const canvas = els.shotChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#65727a";
  ctx.font = "14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, rect.width / 2, rect.height / 2);
  els.chartLegend.innerHTML = "";
}

function numericArray(value, options = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map(Number)
    .filter((number) => Number.isFinite(number) && Math.abs(number) < 100000)
    .filter((number) => !options.nonNegative || number >= 0);
}

function chartDomain(lines, scale, options = {}) {
  const values = lines.filter((line) => line.scale === scale).flatMap((line) => line.values);
  if (!values.length) {
    return { min: options.fallbackMin ?? 0, max: options.fallbackMax ?? 1 };
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (options.floorZero) min = 0;
  const padding = options.padding ?? Math.max(0.5, (max - min) * 0.08);
  if (!options.floorZero) min -= padding;
  max += padding;
  if (options.floorZero) min = 0;
  const minRange = options.minRange || 1;
  if (max - min < minRange) {
    if (options.floorZero) {
      max = min + minRange;
    } else {
      const mid = (min + max) / 2;
      min = mid - (minRange / 2);
      max = mid + (minRange / 2);
    }
  }
  return { min, max };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function adjustNumber(input, field, direction) {
  const step = Number(field.smallincrement) || 1;
  const decimals = Number.isFinite(Number(field.n_decimals)) ? Number(field.n_decimals) : decimalPlaces(step);
  const fallback = direction > 0 ? 0 : Number(input.value) || 0;
  let next = (Number(input.value) || fallback) + (step * direction);
  const min = Number(field.min);
  const max = Number(field.max);
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);
  input.value = Number(next.toFixed(Math.min(6, Math.max(0, decimals))));
}

function decimalPlaces(value) {
  const text = String(value);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

async function getCategoryValues(field) {
  if (state.demo) return [];
  if (state.categoryValues.has(field)) return state.categoryValues.get(field);
  try {
    const data = await fetchJson(API.values(field));
    const values = [...new Set((data.values || []).map(cleanValue).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    state.categoryValues.set(field, values);
    return values;
  } catch {
    return [];
  }
}

async function saveInlineEdits() {
  if (!state.selectedDetail || state.dirtyValues.size === 0) return;
  const fields = {};
  for (const [name, entry] of state.dirtyValues.entries()) {
    if (entry.type === "number") {
      fields[name] = entry.value === "" ? "" : Number(entry.value);
    } else {
      fields[name] = entry.value;
    }
  }
  const syncVisualizer = state.mode === "history" && state.visualizerSync && hasVisualizerLink();

  els.editButton.disabled = true;
  els.editButton.textContent = syncVisualizer ? "Saving + syncing..." : "Saving...";
  if (syncVisualizer) {
    state.visualizerStatus = "Will sync after the local save";
    updateVisualizerStatus();
  }

  if (state.demo) {
    const existing = state.selectedDetail.fields || [];
    state.selectedDetail.fields = existing.map((field) => ({ ...field, value: fields[field.name] ?? field.value }));
    Object.assign(state.selectedDetail.shot, fields);
    renderDetail(state.selectedDetail);
    return;
  }

  const url = state.mode === "next" ? API.next : API.shot(state.selectedClock);
  const data = await fetchJson(url, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  state.selectedDetail = normalizeDetail(data);
  renderDetail(state.selectedDetail);
  if (state.mode === "history") await loadShots();
  if (syncVisualizer) await syncVisualizerEdits(fields);
}

async function syncVisualizerEdits(fields) {
  if (!state.selectedClock || state.selectedClock === "next") return;
  state.visualizerStatus = "Syncing Visualizer...";
  updateVisualizerStatus();
  try {
    const data = await fetchJson(API.visualizer(state.selectedClock), {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    const result = data.visualizer || {};
    if (result.synced) {
      const count = Array.isArray(result.fields) ? result.fields.length : 0;
      state.visualizerStatus = `Visualizer synced (${count} field${count === 1 ? "" : "s"})`;
    } else {
      state.visualizerStatus = result.error || "Visualizer was not synced";
    }
  } catch (error) {
    state.visualizerStatus = `Visualizer sync failed: ${error.message}`;
  }
  updateVisualizerStatus();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function setMode(mode, options = {}) {
  setModeChrome(mode);
  state.selectedClock = null;
  if (mode === "history") {
    if (options.updateUrl !== false) writeRoute({ shot: null, view: null });
    setMobileView("list", { instant: true, scroll: false });
  } else {
    if (options.updateUrl !== false) writeRoute({ shot: null, view: "next" });
    setMobileView("detail", { instant: true, scroll: false });
  }
  if (state.demo && mode === "next") {
    state.selectedDetail = {
      ok: true,
      shot: { kind: "next", profile_title: "Next Shot", bean_brand: "Kawa", bean_type: "Colombia El Diviso", grinder_dose_weight: 18, drink_weight: 54 },
      fields: DEFAULT_SCHEMA.map((field) => ({ name: field.key, value: field.key === "bean_brand" ? "Kawa" : "" })),
      series: {},
    };
    els.shotList.innerHTML = `<div class="empty-state">Next Shot plan</div>`;
    els.shotCount.textContent = "Next Shot";
    renderDetail(state.selectedDetail);
    setMobileView("detail", { instant: true, scroll: false });
  } else {
    loadShots().catch((error) => {
      els.connectionState.textContent = error.message;
    });
  }
}

let searchTimer;
els.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadShots().catch((error) => {
    els.connectionState.textContent = error.message;
  }), 180);
});
els.refreshButton.addEventListener("click", () => loadShots().catch((error) => {
  els.connectionState.textContent = error.message;
}));
els.historyTab.addEventListener("click", () => setMode("history"));
els.nextTab.addEventListener("click", () => setMode("next"));
els.backToShotsButton.addEventListener("click", () => {
  writeRoute({ shot: null, view: null }, { replace: true });
  setMobileView("list");
});
els.editButton.addEventListener("click", () => saveInlineEdits().catch((error) => {
  els.connectionState.textContent = error.message;
  updateSaveButton();
}));
mobileQuery.addEventListener("change", () => {
  applyResponsiveView();
  selectFirstShotForWideLayout().catch((error) => {
    els.connectionState.textContent = error.message;
  });
});
window.addEventListener("popstate", () => {
  applyRoute({ instant: true, scroll: false }).catch((error) => {
    els.connectionState.textContent = error.message;
  });
});
window.addEventListener("resize", () => {
  applyResponsiveView();
  if (state.selectedDetail) drawChart(state.selectedDetail.series || {});
});

loadApp();
