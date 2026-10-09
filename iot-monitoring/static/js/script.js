let refreshing = false;
let hasRenderedData = false;

function signalLevel(data) {
  if (data.status !== "Online" || !Number.isFinite(data.signal)) return 0;
  return data.signal >= -80 ? 4 : data.signal >= -90 ? 3 : data.signal >= -100 ? 2 : 1;
}

function signalText(data) {
  return signalLevel(data) ? `${data.signal} dBm` : "Tidak tersedia";
}

function statusClass(status) {
  return `badge rounded-pill text-bg-${status === "Online" ? "success" : status === "Offline" ? "danger" : "secondary"}`;
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
    "device-status": data.hasData ? data.status : "Belum ada data",
    provider: data.provider ?? "Belum diketahui",
    signal: signalText(data),
    "signal-label": level ? `${["", "Sangat lemah", "Lemah", "Sedang", "Kuat"][level]} · ${level}/4 bar` : "0/4 bar · Sinyal tidak tersedia",
    quota: data.quota === null ? "Belum diketahui" : `${data.quota.toFixed(1)} GB`,
    expiry: data.expiredDate ?? "Belum diketahui",
    "last-update": data.received_at ?? "Belum ada data",
    "quota-check": `Cek terakhir: ${data.quota_check_status}. Cek sukses (UTC): ${data.quota_checked_at ?? "belum diketahui"}.`
  };

  for (const [id, value] of Object.entries(values)) {
    document.getElementById(id).textContent = value;
  }

  const quotaBadge = document.getElementById("quota-status");
  const quotaState = quotaStatus(data.quota);
  quotaBadge.textContent = quotaState.label;
  quotaBadge.className = `badge rounded-pill text-bg-${quotaState.color}`;
  document.getElementById("device-status").className = statusClass(data.status);
  Array.from(document.getElementById("signal-bars").children).forEach((bar, index) => {
    bar.className = index < level ? "active" : "";
  });
}

function renderHistory(history) {
  const body = document.getElementById("history-body");
  body.replaceChildren();
  if (!history.length) {
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "Belum ada riwayat untuk node ini.";
    const row = document.createElement("tr");
    row.appendChild(cell);
    body.appendChild(row);
  }

  for (const reading of history) {
    const row = document.createElement("tr");
    const values = [
      reading.received_at,
      reading.nodeId,
      reading.status_at_observation,
      reading.provider ?? "Belum diketahui",
      reading.signal === null ? "Belum diketahui" : `${reading.signal} dBm`,
      reading.quota === null ? "Belum diketahui" : `${reading.quota.toFixed(1)} GB`,
      reading.expiredDate ?? "Belum diketahui"
    ];

    for (const [index, value] of values.entries()) {
      const cell = document.createElement("td");
      if (index === 2) {
        const badge = document.createElement("span");
        badge.className = statusClass(reading.status_at_observation);
        badge.textContent = value;
        cell.appendChild(badge);
      } else {
        cell.textContent = value;
      }
      row.appendChild(cell);
    }

    body.appendChild(row);
  }
}

async function refreshData() {
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
    message.textContent = !data.hasData ? "Belum ada data untuk node ini."
      : data.status === "Offline" ? "Heartbeat kedaluwarsa atau belum diketahui. Data terakhir mungkin usang."
      : data.quota_check_status === "failed" ? "Cek kuota gagal. Nilai dan waktu sukses terakhir dipertahankan."
      : `Status dihitung server pada ${data.server_time}. Polling 10 detik; waktu cek kuota terpisah dari heartbeat.`;
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
