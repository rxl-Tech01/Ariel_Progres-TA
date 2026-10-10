let refreshing = false;
let hasRenderedData = false;
let lastHistoryJSON = null;

const wibFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function formatTime(value) {
  return value === null ? "Belum diketahui" : `${wibFormatter.format(new Date(value))} WIB`;
}

function checkLabel(status) {
  return { unknown: "Belum diketahui", success: "Berhasil", failed: "Gagal" }[status];
}

function deviceLabel(status) {
  return { Unknown: "Belum diketahui", Online: "Terhubung", Offline: "Tidak terhubung" }[status];
}

function quotaAge(checkedAt, serverTime) {
  if (checkedAt === null) return "Belum ada waktu cek sukses yang diketahui.";
  const seconds = Math.floor((Date.parse(serverTime) - Date.parse(checkedAt)) / 1000);
  if (seconds < 0) return "Waktu cek melampaui waktu server; umur belum dapat dihitung.";
  const age = seconds < 60 ? `${seconds} detik` : seconds < 3600 ? `${Math.floor(seconds / 60)} menit`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)} jam` : `${Math.floor(seconds / 86400)} hari`;
  return `Umur sejak cek sukses: ${age} (saat pembaruan layar).`;
}

function signalLevel(data) {
  if (data.status !== "Online" || !Number.isFinite(data.signal)) return 0;
  return data.signal >= -80 ? 4 : data.signal >= -90 ? 3 : data.signal >= -100 ? 2 : 1;
}

function signalText(data) {
  return signalLevel(data) ? `${data.signal} dBm` : "Tidak tersedia";
}

function statusClass(status) {
  return `badge text-bg-${status === "Online" ? "success" : status === "Offline" ? "danger" : "secondary"}`;
}

function checkClass(status) {
  return `badge text-bg-${{ success: "success", failed: "danger", unknown: "secondary" }[status]}`;
}

function quotaStatus(quota) {
  if (quota === null) return { label: "Belum diketahui", color: "secondary" };
  if (quota > 2) return { label: "Aman", color: "success" };
  if (quota >= 1) return { label: "Peringatan", color: "warning" };
  return { label: "Kritis", color: "danger" };
}

function validateNodeData(data) {
  if (!data || typeof data.nodeId !== "string" || typeof data.hasData !== "boolean" ||
      !["provider", "expiredDate"].every(key => data[key] === null || typeof data[key] === "string") ||
      !["received_at", "heartbeat_at", "quota_checked_at", "server_time"].every(
        key => data[key] === null || (typeof data[key] === "string" && Number.isFinite(Date.parse(data[key])))
      ) ||
      !["Online", "Offline", "Unknown"].includes(data.status) ||
      !["unknown", "success", "failed"].includes(data.quota_check_status) ||
      !(data.quota === null || (Number.isFinite(data.quota) && data.quota >= 0)) ||
      !(data.signal === null || Number.isFinite(data.signal))) {
    throw new Error("Format data node tidak valid.");
  }
}

async function getNodeData(path, signal) {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function renderDashboard(data) {
  const level = signalLevel(data);
  const values = {
    "node-id": data.nodeId,
    "device-status": data.hasData ? deviceLabel(data.status) : "Belum ada data",
    provider: data.provider ?? "Belum diketahui",
    signal: signalText(data),
    "signal-label": level ? `${["", "Sangat lemah", "Lemah", "Sedang", "Kuat"][level]} · ${level}/4 bar` : "0/4 bar · Sinyal tidak tersedia",
    quota: data.quota === null ? "Belum diketahui" : `${data.quota.toFixed(1)} GB`,
    expiry: data.expiredDate ?? "Belum diketahui",
    "last-update": data.received_at === null ? "Belum ada data" : formatTime(data.received_at),
    "check-status": checkLabel(data.quota_check_status),
    "quota-time": formatTime(data.quota_checked_at),
    "quota-check": data.quota_check_status === "failed"
      ? "Pembaruan gagal. Periksa waktu dan nilai terakhir yang tersedia."
      : data.quota_check_status === "success" ? "Laporan cek terakhir berhasil. Perhatikan umur pembacaan kuota."
      : "Belum ada hasil cek kuota yang terkonfirmasi.",
    "quota-age": quotaAge(data.quota_checked_at, data.server_time)
  };

  // ID HTML menjadi penghubung: data.quota -> elemen dengan id="quota".
  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).textContent = value;
  }

  const quotaBadge = document.getElementById("quota-status");
  const quotaState = quotaStatus(data.quota);
  quotaBadge.textContent = quotaState.label;
  quotaBadge.className = `badge text-bg-${quotaState.color}`;
  document.getElementById("quota").className = `quota-value${data.quota === null ? " is-unknown" : ""}`;
  document.getElementById("check-status").className = checkClass(data.quota_check_status);
  document.getElementById("device-status").className = statusClass(data.status);
  Array.from(document.getElementById("signal-bars").children).forEach((bar, index) => {
    bar.className = index < level ? "active" : "";
  });
}

function renderHistory(history) {
  // Polling dengan riwayat sama tidak membangun ulang DOM, agar fokus/detail tetap terbuka.
  const historyJSON = JSON.stringify(history);
  if (historyJSON === lastHistoryJSON) return;
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
  lastHistoryJSON = historyJSON;
}

// textContent menampilkan data sebagai teks, bukan mengeksekusinya sebagai HTML.
function textElement(tag, value, className = "") {
  const element = document.createElement(tag);
  element.textContent = value;
  element.className = className;
  return element;
}

function renderMobileHistory(history) {
  const cards = document.getElementById("history-cards");
  const openReadings = new Set(Array.from(cards.querySelectorAll("details[open]"), detail => detail.dataset.reading));
  cards.replaceChildren();
  if (!history.length) cards.appendChild(textElement("li", "Belum ada riwayat untuk node ini.", "empty-cell"));
  for (const reading of history) {
    const card = document.createElement("li");
    card.className = "history-card";
    const header = document.createElement("div");
    header.className = "history-card-head";
    header.appendChild(textElement("p", formatTime(reading.received_at), "history-card-time"));
    header.appendChild(textElement("p", reading.quota === null ? "Belum diketahui" : `${reading.quota.toFixed(1)} GB`, "history-card-quota"));
    card.appendChild(header);
    const statuses = document.createElement("div");
    statuses.className = "history-card-statuses";
    const connection = textElement("p", "Koneksi");
    connection.appendChild(textElement("span", deviceLabel(reading.status_at_observation), statusClass(reading.status_at_observation)));
    const check = textElement("p", "Cek");
    check.appendChild(textElement("span", checkLabel(reading.quota_check_status), checkClass(reading.quota_check_status)));
    statuses.appendChild(connection);
    statuses.appendChild(check);
    card.appendChild(statuses);
    const detail = document.createElement("details");
    detail.dataset.reading = `${reading.nodeId}/${reading.received_at}`;
    detail.open = openReadings.has(detail.dataset.reading);
    detail.appendChild(textElement("summary", "Detail observasi"));
    const fields = document.createElement("dl");
    for (const [label, value] of [
      ["Node", reading.nodeId], ["Operator", reading.provider ?? "Belum diketahui"],
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

async function refreshData() {
  // Alur: GET API -> validasi JSON -> isi kartu dan riwayat. Tidak menulis database.
  if (refreshing) return;
  refreshing = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  const button = document.getElementById("refresh-button");
  const message = document.getElementById("refresh-message");
  button.disabled = true;
  message.classList.remove("is-error");
  message.textContent = "Mengambil data node…";

  try {
    const data = await getNodeData("/api/node/latest", controller.signal);
    validateNodeData(data);
    const history = await getNodeData("/api/node/history", controller.signal);
    if (!history || history.nodeId !== data.nodeId || !Array.isArray(history.readings) ||
        history.readings.length > 10 || typeof history.server_time !== "string" ||
        !Number.isFinite(Date.parse(history.server_time))) {
      throw new Error("Format riwayat tidak valid.");
    }
    for (const reading of history.readings) {
      validateNodeData({ ...reading, status: reading.status_at_observation, server_time: history.server_time });
      if (reading.nodeId !== data.nodeId || !reading.hasData || reading.received_at === null) {
        throw new Error("Observasi riwayat tidak valid.");
      }
    }
    renderDashboard(data);
    renderHistory(history.readings);
    hasRenderedData = data.hasData || history.readings.length > 0;
    const notices = [];
    if (!data.hasData) notices.push("Belum ada data untuk node ini.");
    else {
      if (data.status === "Offline") notices.push("Perangkat tidak terhubung atau waktu kabar terakhir belum diketahui. Data terakhir mungkin usang.");
      if (data.quota_check_status === "failed") notices.push(data.quota_checked_at === null
        ? "Cek kuota gagal. Belum ada waktu cek sukses yang diketahui."
        : "Cek kuota gagal. Nilai dan waktu sukses terakhir dipertahankan.");
      if (data.quota_check_status === "unknown") notices.push("Keberhasilan cek kuota belum diketahui.");
    }
    notices.push(`Pembaruan layar: ${formatTime(data.server_time)}.`);
    message.textContent = notices.join(" ");
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
setInterval(refreshData, 10000);
