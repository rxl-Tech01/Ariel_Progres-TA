// 1. Konfigurasi dan status pembaruan
const REFRESH_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 9_000;
const HISTORY_LIMIT = 10;

// Label demo tetap berlaku meskipun data uji melaporkan status Online.
const demoMode = document.body?.dataset.demoMode !== "false";

const wibFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

let refreshing = false;
let hasRenderedData = false;
let lastHistoryJSON = null;

// 2. Format waktu, label demo, dan indikator status
function formatTime(value) {
  return value === null
    ? "Belum diketahui"
    : `${wibFormatter.format(new Date(value))} WIB`;
}

function quotaAge(checkedAt, serverTime) {
  if (checkedAt === null) {
    return "Belum ada waktu cek sukses yang diketahui.";
  }

  const seconds = Math.floor((Date.parse(serverTime) - Date.parse(checkedAt)) / 1000);
  if (seconds < 0) {
    return "Waktu cek melampaui waktu server; umur belum dapat dihitung.";
  }

  let age;
  if (seconds < 60) {
    age = `${seconds} detik`;
  } else if (seconds < 3600) {
    age = `${Math.floor(seconds / 60)} menit`;
  } else if (seconds < 86400) {
    age = `${Math.floor(seconds / 3600)} jam`;
  } else {
    age = `${Math.floor(seconds / 86400)} hari`;
  }

  return `Umur sejak cek sukses: ${age} (saat pembaruan layar).`;
}

function checkLabel(status) {
  const label = {
    unknown: "Belum diketahui",
    success: "Berhasil",
    failed: "Gagal"
  }[status];

  return demoMode && status !== "unknown" ? `${label} (simulasi)` : label;
}

function deviceLabel(status) {
  if (demoMode) {
    return {
      Unknown: "Belum diketahui",
      Online: "Online (simulasi)",
      Offline: "Offline (simulasi)"
    }[status];
  }

  return {
    Unknown: "Belum diketahui",
    Online: "Terhubung",
    Offline: "Tidak terhubung"
  }[status];
}

function signalLevel(data) {
  if (data.status !== "Online" || !Number.isFinite(data.signal)) {
    return 0;
  }
  if (data.signal >= -80) {
    return 4;
  }
  if (data.signal >= -90) {
    return 3;
  }
  if (data.signal >= -100) {
    return 2;
  }
  return 1;
}

function signalText(data) {
  return signalLevel(data) ? `${data.signal} dBm` : "Tidak tersedia";
}

function statusClass(status) {
  if (status === "Online") {
    return "badge text-bg-success";
  }
  if (status === "Offline") {
    return "badge text-bg-danger";
  }
  return "badge text-bg-secondary";
}

function checkClass(status) {
  const color = {
    success: "success",
    failed: "danger",
    unknown: "secondary"
  }[status];

  return `badge text-bg-${color}`;
}

function quotaStatus(quota) {
  if (quota === null) {
    return { label: "Belum diketahui", color: "secondary" };
  }
  if (quota > 2) {
    return { label: "Aman", color: "success" };
  }
  if (quota >= 1) {
    return { label: "Peringatan", color: "warning" };
  }
  return { label: "Kritis", color: "danger" };
}

function quotaCheckMessage(status) {
  if (demoMode) {
    return "Hasil skenario pengujian, belum ada cek kuota melalui modem.";
  }
  if (status === "failed") {
    return "Pembaruan gagal. Periksa waktu dan nilai terakhir yang tersedia.";
  }
  if (status === "success") {
    return "Laporan cek terakhir berhasil. Perhatikan umur pembacaan kuota.";
  }
  return "Belum ada hasil cek kuota yang terkonfirmasi.";
}

// 3. Validasi dan pengambilan data API
function validateNodeData(data) {
  if (
    !data ||
    typeof data.nodeId !== "string" ||
    typeof data.hasData !== "boolean" ||
    !["provider", "expiredDate"].every(
      key => data[key] === null || typeof data[key] === "string"
    ) ||
    !["received_at", "heartbeat_at", "quota_checked_at", "server_time"].every(
      key => data[key] === null || (
        typeof data[key] === "string" && Number.isFinite(Date.parse(data[key]))
      )
    ) ||
    !["Online", "Offline", "Unknown"].includes(data.status) ||
    !["unknown", "success", "failed"].includes(data.quota_check_status) ||
    !(data.quota === null || (Number.isFinite(data.quota) && data.quota >= 0)) ||
    !(data.signal === null || Number.isFinite(data.signal))
  ) {
    throw new Error("Format data node tidak valid.");
  }
}

function validateHistoryData(history, nodeId) {
  if (
    !history ||
    history.nodeId !== nodeId ||
    !Array.isArray(history.readings) ||
    history.readings.length > HISTORY_LIMIT ||
    typeof history.server_time !== "string" ||
    !Number.isFinite(Date.parse(history.server_time))
  ) {
    throw new Error("Format riwayat tidak valid.");
  }

  for (const reading of history.readings) {
    validateNodeData({
      ...reading,
      status: reading.status_at_observation,
      server_time: history.server_time
    });

    if (reading.nodeId !== nodeId || !reading.hasData || reading.received_at === null) {
      throw new Error("Observasi riwayat tidak valid.");
    }
  }
}

async function getNodeData(path, signal) {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

// 4. Pembuat elemen DOM dan SVG
// textContent menjaga data API tetap ditampilkan sebagai teks.
function textElement(tag, value, className = "") {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function svgElement(tag, attributes, value) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, attribute] of Object.entries(attributes)) {
    element.setAttribute(name, attribute);
  }
  if (value !== undefined) {
    element.textContent = value;
  }
  return element;
}

// 5. Kartu ringkasan dashboard
function renderDashboard(data) {
  const level = signalLevel(data);
  const values = {
    "node-id": data.nodeId,
    "device-status": demoMode ? "Hardware belum terhubung"
      : data.hasData ? deviceLabel(data.status)
      : "Belum ada data",
    provider: data.provider ?? "Belum diketahui",
    signal: signalText(data),
    "signal-label": level
      ? `${["", "Sangat lemah", "Lemah", "Sedang", "Kuat"][level]} · ${level}/4 bar`
      : "0/4 bar · Sinyal tidak tersedia",
    quota: data.quota === null ? "Belum diketahui" : `${data.quota.toFixed(1)} GB`,
    expiry: data.expiredDate ?? "Belum diketahui",
    "last-update": data.received_at === null ? "Belum ada data" : formatTime(data.received_at),
    "check-status": checkLabel(data.quota_check_status),
    "quota-time": formatTime(data.quota_checked_at),
    "quota-check": quotaCheckMessage(data.quota_check_status),
    "quota-age": quotaAge(data.quota_checked_at, data.server_time)
  };

  // ID HTML menjadi penghubung: data.quota -> elemen dengan id="quota".
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).textContent = value;
  }

  const quotaBadge = document.getElementById("quota-status");
  const quotaState = quotaStatus(data.quota);
  quotaBadge.textContent = demoMode && data.quota !== null
    ? `${quotaState.label} (contoh)`
    : quotaState.label;
  quotaBadge.className = `badge text-bg-${quotaState.color}`;

  document.getElementById("quota").className =
    `quota-value${data.quota === null ? " is-unknown" : ""}`;
  document.getElementById("check-status").className =
    checkClass(data.quota_check_status);
  document.getElementById("device-status").className =
    statusClass(demoMode ? "Unknown" : data.status);

  Array.from(document.getElementById("signal-bars").children).forEach((bar, index) => {
    bar.className = index < level ? "active" : "";
  });
}

// 6. Riwayat observasi: tabel desktop dan kartu mobile
function renderHistory(history) {
  // Polling dengan riwayat sama tidak membangun ulang DOM, agar fokus/detail tetap terbuka.
  const historyJSON = JSON.stringify(history);
  if (historyJSON === lastHistoryJSON) {
    return;
  }

  document.getElementById("history-count").textContent = history.length;
  const body = document.getElementById("history-body");
  body.replaceChildren();

  if (!history.length) {
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.className = "empty-cell";
    cell.textContent = "Belum ada riwayat untuk node ini.";
    const row = document.createElement("tr");
    row.appendChild(cell);
    body.appendChild(row);
  }

  for (const reading of history) {
    const row = document.createElement("tr");
    const values = [
      formatTime(reading.received_at),
      reading.nodeId,
      deviceLabel(reading.status_at_observation),
      reading.provider ?? "Belum diketahui",
      reading.signal === null ? "Belum diketahui" : `${reading.signal} dBm`,
      reading.quota === null ? "Belum diketahui" : `${reading.quota.toFixed(1)} GB`,
      checkLabel(reading.quota_check_status),
      formatTime(reading.quota_checked_at),
      reading.expiredDate ?? "Belum diketahui"
    ];

    for (const [index, value] of values.entries()) {
      const cell = document.createElement("td");
      if (index === 2) {
        const badge = document.createElement("span");
        badge.className = statusClass(reading.status_at_observation);
        badge.textContent = value;
        cell.appendChild(badge);
      } else if (index === 6) {
        const badge = document.createElement("span");
        badge.className = checkClass(reading.quota_check_status);
        badge.textContent = value;
        cell.appendChild(badge);
      } else {
        cell.textContent = value;
      }
      row.appendChild(cell);
    }

    body.appendChild(row);
  }
  renderMobileHistory(history);
  renderTrends(history);
  lastHistoryJSON = historyJSON;
}

function renderMobileHistory(history) {
  const cards = document.getElementById("history-cards");
  const openReadings = new Set(Array.from(
    cards.querySelectorAll("details[open]"),
    detail => detail.dataset.reading
  ));
  cards.replaceChildren();

  if (!history.length) {
    cards.appendChild(textElement("li", "Belum ada riwayat untuk node ini.", "empty-cell"));
  }

  for (const reading of history) {
    const card = document.createElement("li");
    card.className = "history-card";

    const header = document.createElement("div");
    header.className = "history-card-head";
    header.appendChild(textElement("p", formatTime(reading.received_at), "history-card-time"));
    header.appendChild(textElement("p",
      reading.quota === null ? "Belum diketahui" : `${reading.quota.toFixed(1)} GB`,
      "history-card-quota"
    ));
    card.appendChild(header);

    const statuses = document.createElement("div");
    statuses.className = "history-card-statuses";

    const connection = textElement("p", "Koneksi");
    connection.appendChild(textElement("span",
      deviceLabel(reading.status_at_observation),
      statusClass(reading.status_at_observation)
    ));

    const check = textElement("p", "Cek");
    check.appendChild(textElement("span",
      checkLabel(reading.quota_check_status),
      checkClass(reading.quota_check_status)
    ));

    statuses.appendChild(connection);
    statuses.appendChild(check);
    card.appendChild(statuses);

    const detail = document.createElement("details");
    detail.dataset.reading = `${reading.nodeId}/${reading.received_at}`;
    detail.open = openReadings.has(detail.dataset.reading);
    detail.appendChild(textElement("summary", "Detail observasi"));

    const fields = document.createElement("dl");
    for (const [label, value] of [
      ["Node", reading.nodeId],
      ["Operator", reading.provider ?? "Belum diketahui"],
      ["Sinyal", reading.signal === null ? "Belum diketahui" : `${reading.signal} dBm`],
      ["Cek sukses (WIB)", formatTime(reading.quota_checked_at)],
      ["Masa aktif", reading.expiredDate ?? "Belum diketahui"]
    ]) {
      fields.appendChild(textElement("dt", label));
      fields.appendChild(textElement("dd", value));
    }

    detail.appendChild(fields);
    card.appendChild(detail);
    cards.appendChild(card);
  }
}

// 7. Pengolahan seri dan grafik telemetri
function trendSeries(history, key) {
  const seen = new Set();
  const readings = history.filter(reading =>
    Number.isFinite(reading[key]) &&
    (key !== "quota" || reading.quota_checked_at !== null)
  );

  return readings
    .map(reading => ({
      time: key === "quota" ? reading.quota_checked_at : reading.received_at,
      value: reading[key]
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .filter(point => {
      if (seen.has(point.time)) {
        return false;
      }
      seen.add(point.time);
      return true;
    });
}

function renderTrends(history) {
  for (const key of ["quota", "signal"]) {
    const series = trendSeries(history, key);
    const chart = document.getElementById(`${key}-chart`);
    chart.replaceChildren();
    // SVG tidak memiliki properti hidden yang merefleksikan atribut HTML.
    chart.toggleAttribute("hidden", series.length === 0);
    document.getElementById(`${key}-chart-empty`).hidden = series.length > 0;
    document.getElementById(`${key}-chart-start`).textContent = series.length
      ? formatTime(series[0].time)
      : "—";
    document.getElementById(`${key}-chart-end`).textContent = series.length
      ? formatTime(series[series.length - 1].time)
      : "—";

    if (!series.length) {
      continue;
    }

    const values = series.map(point => point.value);
    const low = Math.min(...values);
    const high = Math.max(...values);

    // Normalisasi menghindari overflow untuk angka API yang sangat besar.
    const scale = Math.max(Math.abs(low), Math.abs(high), 1);
    const range = high / scale - low / scale;
    const start = Date.parse(series[0].time);
    const duration = Date.parse(series[series.length - 1].time) - start;
    const points = series.map(point => ({
      ...point,
      x: duration
        ? 60 + (Date.parse(point.time) - start) / duration * 520
        : 320,
      y: range
        ? 152 - (point.value / scale - low / scale) / range * 124
        : 90
    }));

    for (const y of [28, 90, 152]) {
      chart.appendChild(svgElement("line", {
        x1: 60,
        x2: 580,
        y1: y,
        y2: y,
        class: "chart-gridline"
      }));
    }

    const axisLabel = value => new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 1,
      notation: "compact"
    }).format(value);

    chart.appendChild(svgElement("text", {
      x: 4,
      y: range ? 32 : 94,
      class: "chart-axis"
    }, axisLabel(high)));

    if (range) {
      chart.appendChild(svgElement("text", {
        x: 4,
        y: 156,
        class: "chart-axis"
      }, axisLabel(low)));
    }

    chart.appendChild(svgElement("polyline", {
      points: points.map(point => `${point.x},${point.y}`).join(" "),
      class: "chart-line"
    }));

    for (const point of points) {
      const circle = svgElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 4,
        class: "chart-point"
      });
      circle.appendChild(svgElement("title", {},
        `${formatTime(point.time)} · ${point.value} ${key === "quota" ? "GB" : "dBm"}${demoMode ? " (data dummy)" : ""}`
      ));
      chart.appendChild(circle);
    }
  }
}

// 8. Pesan pembaruan dan alur refresh
function buildRefreshMessage(data) {
  const notices = [];

  if (demoMode) {
    notices.push(data.hasData
      ? "Menampilkan data dummy. Hardware belum terhubung."
      : "Belum ada data uji tersimpan. Hardware belum terhubung."
    );
  } else if (!data.hasData) {
    notices.push("Belum ada data untuk node ini.");
  } else {
    if (data.status === "Offline") {
      notices.push("Perangkat tidak terhubung atau waktu kabar terakhir belum diketahui. Data terakhir mungkin usang.");
    }
    if (data.quota_check_status === "failed") {
      notices.push(data.quota_checked_at === null
        ? "Cek kuota gagal. Belum ada waktu cek sukses yang diketahui."
        : "Cek kuota gagal. Nilai dan waktu sukses terakhir dipertahankan."
      );
    }
    if (data.quota_check_status === "unknown") {
      notices.push("Keberhasilan cek kuota belum diketahui.");
    }
  }

  notices.push(`Pembaruan layar: ${formatTime(data.server_time)}.`);
  return notices.join(" ");
}

async function refreshData() {
  // Alur: GET API -> validasi JSON -> isi kartu dan riwayat. Tidak menulis database.
  if (refreshing) {
    return;
  }
  refreshing = true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const button = document.getElementById("refresh-button");
  const message = document.getElementById("refresh-message");

  button.disabled = true;
  message.classList.remove("is-error");
  message.textContent = demoMode
    ? "Memperbarui tampilan data dummy…"
    : "Mengambil data node…";

  try {
    const data = await getNodeData("/api/node/latest", controller.signal);
    validateNodeData(data);

    const history = await getNodeData("/api/node/history", controller.signal);
    validateHistoryData(history, data.nodeId);

    renderDashboard(data);
    renderHistory(history.readings);
    hasRenderedData = data.hasData || history.readings.length > 0;
    message.textContent = buildRefreshMessage(data);
  } catch (error) {
    message.classList.add("is-error");
    message.textContent = hasRenderedData
      ? "Gagal mengambil data. Data sebelumnya tetap ditampilkan. Silakan coba lagi."
      : "Gagal mengambil data. Belum ada data tersedia. Silakan coba lagi.";
  } finally {
    clearTimeout(timeout);
    refreshing = false;
    button.disabled = false;
  }
}

// 9. Navigasi sidebar dan akses keyboard
// Navigasi hanya mengubah tampilan; tidak mengirim perintah ke modem atau API.
function initSidebar() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return;
  }

  const sidebar = document.getElementById("app-sidebar");
  const toggle = document.getElementById("mobile-nav-toggle");
  const close = document.getElementById("sidebar-close");
  const backdrop = document.getElementById("sidebar-backdrop");
  const main = document.getElementById("main-content");
  if (!sidebar || !toggle || !close || !backdrop || !main) {
    return;
  }

  const desktop = window.matchMedia("(min-width: 1024px)");
  const links = Array.from(sidebar.querySelectorAll("nav a"));
  let open = false;

  function setOpen(requested, restoreFocus = true) {
    open = requested && !desktop.matches;
    document.body.classList.toggle("sidebar-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    backdrop.hidden = !open;
    main.inert = open;
    sidebar.inert = !desktop.matches && !open;

    if (open) {
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
      // Tunggu drawer terlihat sebelum memindahkan fokus keyboard.
      window.requestAnimationFrame(() => {
        if (open) {
          close.focus();
        }
      });
    } else {
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
      if (restoreFocus && !desktop.matches) {
        toggle.focus();
      }
    }
  }

  function updateCurrentLink() {
    const current = window.location.hash || "#overview";
    for (const link of links) {
      if (link.getAttribute("href") === current) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }

  document.body.classList.add("nav-enhanced");
  toggle.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  for (const link of links) {
    link.addEventListener("click", () => {
      if (!desktop.matches) {
        setOpen(false, false);
      }

      const destination = document.querySelector(link.getAttribute("href"));
      if (destination) {
        if (destination.tagName === "DETAILS") {
          destination.open = true;
        }
        destination.setAttribute("tabindex", "-1");
        destination.focus({ preventScroll: true });
      }
    });
  }

  document.addEventListener("keydown", event => {
    if (!open) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") {
      const items = Array.from(sidebar.querySelectorAll(
        "a[href], button:not([disabled])"
      ));
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  desktop.addEventListener("change", () => {
    setOpen(false, sidebar.contains(document.activeElement));
  });
  window.addEventListener("hashchange", updateCurrentLink);
  setOpen(false, false);
  updateCurrentLink();
}

// 10. Inisialisasi halaman
console.assert(
  quotaStatus(2.1).label === "Aman" &&
  quotaStatus(2).label === "Peringatan" &&
  quotaStatus(1).label === "Peringatan" &&
  quotaStatus(0.9).label === "Kritis" &&
  quotaStatus(0).label === "Kritis",
  "Status kuota harus sesuai batas 1 GB dan 2 GB."
);

document.getElementById("refresh-button").addEventListener("click", refreshData);
refreshData();
setInterval(refreshData, REFRESH_INTERVAL_MS);
initSidebar();
