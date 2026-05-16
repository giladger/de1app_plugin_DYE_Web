const API = {
  status: "/api/status",
  schema: "/api/schema",
  shots: "/api/shots",
  next: "/api/next",
  shot: (clock) => `/api/shots/${clock}`,
  values: (field) => `/api/fields/${encodeURIComponent(field)}/values`,
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
  editButton: document.querySelector("#editButton"),
  editorDialog: document.querySelector("#editorDialog"),
  editorForm: document.querySelector("#editorForm"),
  editorEyebrow: document.querySelector("#editorEyebrow"),
  editorTitle: document.querySelector("#editorTitle"),
  editorFields: document.querySelector("#editorFields"),
  saveButton: document.querySelector("#saveButton"),
};

function fmt(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return number.toFixed(digits).replace(/\.0$/, "");
}

function shotTitle(shot) {
  const beans = [shot.bean_brand, shot.bean_type].filter(Boolean).join(" ");
  return beans || shot.profile_title || shot.filename || "Shot";
}

function shotSubtitle(shot) {
  const profile = shot.profile_title || "No profile";
  const date = shot.iso_time ? new Date(shot.iso_time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  return [profile, date].filter(Boolean).join(" @ ");
}

function metricText(shot) {
  const dose = fmt(shot.grinder_dose_weight);
  const drink = fmt(shot.drink_weight);
  const ratio = shot.ratio ? `1:${fmt(shot.ratio, 2)}` : "-";
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

async function loadApp() {
  try {
    const [status, schema] = await Promise.all([fetchJson(API.status), fetchJson(API.schema)]);
    state.demo = false;
    state.schema = schema.fields?.length ? schema.fields : DEFAULT_SCHEMA;
    els.connectionState.textContent = `${status.shots ?? 0} in SDB`;
    await loadShots();
  } catch (error) {
    state.demo = true;
    state.schema = DEFAULT_SCHEMA;
    state.shots = DEMO_SHOTS;
    els.connectionState.textContent = "Preview data";
    renderShotList();
    await selectShot(DEMO_SHOTS[0].clock);
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
    if (state.shots.length) await selectShot(state.shots[0].clock);
    else renderEmptyDetail();
    return;
  }
  const params = new URLSearchParams({ limit: "500" });
  const search = els.searchInput.value.trim();
  if (search) params.set("search", search);
  const data = await fetchJson(`${API.shots}?${params}`);
  state.shots = data.shots || [];
  renderShotList();
  if (state.shots.length) {
    const clock = state.selectedClock && state.shots.some((shot) => shot.clock === state.selectedClock)
      ? state.selectedClock
      : state.shots[0].clock;
    await selectShot(clock);
  } else {
    renderEmptyDetail();
  }
}

async function loadNext() {
  els.shotList.innerHTML = `<div class="empty-state">Next Shot plan</div>`;
  els.shotCount.textContent = "Next Shot";
  const data = await fetchJson(API.next);
  state.selectedClock = "next";
  state.selectedDetail = data;
  renderDetail(data);
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
    button.className = `shot-card ${shot.clock === state.selectedClock ? "active" : ""}`;
    button.innerHTML = `
      <div class="shot-card-title">${escapeHtml(shotTitle(shot))}</div>
      <div class="shot-card-subtitle">${escapeHtml(shotSubtitle(shot))}</div>
      <div class="shot-card-meta">
        <span class="pill">${escapeHtml(metricText(shot))}</span>
        ${shot.grinder_setting ? `<span class="pill">${escapeHtml(shot.grinder_setting)} grind</span>` : ""}
        ${shot.espresso_enjoyment ? `<span class="pill">${escapeHtml(fmt(shot.espresso_enjoyment, 0))}/100</span>` : ""}
      </div>
    `;
    button.addEventListener("click", () => selectShot(shot.clock));
    fragment.append(button);
  }
  els.shotList.append(fragment);
}

async function selectShot(clock) {
  state.selectedClock = clock;
  renderShotList();
  let data;
  if (state.demo) {
    const shot = DEMO_SHOTS.find((item) => item.clock === clock) || DEMO_SHOTS[0];
    data = {
      ok: true,
      shot,
      fields: state.schema.map((field) => ({ name: field.key, value: shot[field.key] ?? "" })),
      series: DEMO_SERIES,
    };
  } else {
    data = await fetchJson(API.shot(clock));
  }
  state.selectedDetail = data;
  renderDetail(data);
}

function renderEmptyDetail() {
  state.selectedDetail = null;
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
  const values = new Map(fields.map((field) => [field.name, field.value]));
  return state.schema.map((field) => ({ ...field, value: values.get(field.key) ?? "" }));
}

function renderMetadata(fields) {
  const groups = groupFields(fields);
  els.metadataGrid.innerHTML = "";
  for (const [section, items] of groups) {
    const block = document.createElement("section");
    block.className = "metadata-section";
    block.innerHTML = `
      <h3>${escapeHtml(sectionLabel(section))}</h3>
      <div class="field-list">
        ${items.map((field) => `
          <div class="field-row">
            <div class="field-name">${escapeHtml(field.short_name || field.name)}</div>
            <div class="field-value">${escapeHtml(displayFieldValue(field))}</div>
          </div>
        `).join("")}
      </div>
    `;
    els.metadataGrid.append(block);
  }
}

function groupFields(fields) {
  const order = ["beans", "equipment", "extraction", "tasting", "people", "beverage", "description"];
  const map = new Map();
  for (const field of fields) {
    const section = field.section || "description";
    if (!map.has(section)) map.set(section, []);
    map.get(section).push(field);
  }
  return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}

function sectionLabel(section) {
  const labels = {
    beans: "Beans",
    equipment: "Equipment",
    extraction: "Extraction",
    tasting: "Tasting",
    people: "People",
    beverage: "Beverage",
    description: "Description",
  };
  return labels[section] || section.replace(/_/g, " ");
}

function displayFieldValue(field) {
  if (field.value === null || field.value === undefined || field.value === "") return "-";
  const unit = field.measure_unit || "";
  return `${field.value}${unit && field.data_type === "number" ? unit : ""}`;
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
  ].map((line) => ({ ...line, values: numericArray(series[line.key]) })).filter((line) => line.values.length);

  const pad = { left: 42, right: 42, top: 22, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xMax = Math.max(...elapsed);
  const leftMax = Math.max(10, ...lines.filter((line) => line.scale === "left").flatMap((line) => line.values));
  const rightMax = Math.max(50, ...lines.filter((line) => line.scale === "right").flatMap((line) => line.values));
  const tempMin = 80;
  const tempMax = 100;

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

  function xAt(index) {
    return pad.left + (elapsed[index] / xMax) * plotW;
  }
  function yAt(value, scale) {
    if (scale === "right") return pad.top + plotH - (value / rightMax) * plotH;
    if (scale === "temp") return pad.top + plotH - ((value - tempMin) / (tempMax - tempMin)) * plotH;
    return pad.top + plotH - (value / leftMax) * plotH;
  }

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

function numericArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isFinite);
}

async function openEditor() {
  const detail = state.selectedDetail;
  if (!detail) return;
  const fields = normalizeFields(detail.fields || []);
  els.editorEyebrow.textContent = state.mode === "next" ? "Next Shot" : "Shot Description";
  els.editorTitle.textContent = shotTitle(detail.shot || {});
  els.editorFields.innerHTML = "";

  const groups = groupFields(fields);
  for (const [section, items] of groups) {
    const sectionEl = document.createElement("section");
    sectionEl.className = "editor-section";
    sectionEl.innerHTML = `<h3 class="editor-section-title">${escapeHtml(sectionLabel(section))}</h3>`;
    for (const field of items) {
      sectionEl.append(await renderEditorField(field));
    }
    els.editorFields.append(sectionEl);
  }

  if (typeof els.editorDialog.showModal === "function") {
    els.editorDialog.showModal();
  } else {
    els.editorDialog.setAttribute("open", "");
  }
}

async function renderEditorField(field) {
  const wrap = document.createElement("div");
  wrap.className = "edit-field";
  const id = `field-${field.key}`;
  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = field.name || field.key;
  wrap.append(label);

  let input;
  if (field.data_type === "long_text" || field.data_type === "complex") {
    input = document.createElement("textarea");
    input.value = field.value ?? "";
  } else {
    input = document.createElement("input");
    input.value = field.value ?? "";
    input.type = field.data_type === "number" ? "number" : "text";
    if (field.data_type === "number") {
      if (field.min !== null && field.min !== undefined) input.min = field.min;
      if (field.max !== null && field.max !== undefined) input.max = field.max;
      if (field.smallincrement) input.step = field.smallincrement;
    }
    if (field.data_type === "category") {
      const listId = `${id}-values`;
      input.setAttribute("list", listId);
      const datalist = document.createElement("datalist");
      datalist.id = listId;
      const values = await getCategoryValues(field.key);
      datalist.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
      wrap.append(datalist);
    }
  }
  input.id = id;
  input.name = field.key;
  input.dataset.type = field.data_type || "text";
  wrap.append(input);
  return wrap;
}

async function getCategoryValues(field) {
  if (state.demo) return [];
  if (state.categoryValues.has(field)) return state.categoryValues.get(field);
  try {
    const data = await fetchJson(API.values(field));
    const values = data.values || [];
    state.categoryValues.set(field, values);
    return values;
  } catch {
    return [];
  }
}

async function saveEditor() {
  if (!state.selectedDetail) return;
  const fields = {};
  for (const input of els.editorFields.querySelectorAll("input, textarea")) {
    if (input.dataset.type === "number") {
      fields[input.name] = input.value === "" ? "" : Number(input.value);
    } else {
      fields[input.name] = input.value;
    }
  }

  if (state.demo) {
    const existing = state.selectedDetail.fields || [];
    state.selectedDetail.fields = existing.map((field) => ({ ...field, value: fields[field.name] ?? field.value }));
    Object.assign(state.selectedDetail.shot, fields);
    renderDetail(state.selectedDetail);
    els.editorDialog.close();
    return;
  }

  const url = state.mode === "next" ? API.next : API.shot(state.selectedClock);
  const data = await fetchJson(url, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  state.selectedDetail = data;
  renderDetail(data);
  els.editorDialog.close();
  if (state.mode === "history") await loadShots();
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

function setMode(mode) {
  state.mode = mode;
  state.selectedClock = null;
  els.historyTab.classList.toggle("active", mode === "history");
  els.nextTab.classList.toggle("active", mode === "next");
  els.historyTab.setAttribute("aria-selected", mode === "history" ? "true" : "false");
  els.nextTab.setAttribute("aria-selected", mode === "next" ? "true" : "false");
  els.searchInput.disabled = mode !== "history";
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
els.editButton.addEventListener("click", openEditor);
els.saveButton.addEventListener("click", () => saveEditor().catch((error) => {
  els.connectionState.textContent = error.message;
}));
window.addEventListener("resize", () => {
  if (state.selectedDetail) drawChart(state.selectedDetail.series || {});
});

loadApp();
