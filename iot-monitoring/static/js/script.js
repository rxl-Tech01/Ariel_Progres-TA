let refreshCount = 0;
let history = [];

function addHistory(entries, reading) {
  return [{ ...reading }, ...entries].slice(0, 10);
}

function signalLevel(data) {
  if (data.status !== "Online" || !Number.isFinite(data.signal)) return 0;
  return data.signal >= -80 ? 4 : data.signal >= -90 ? 3 : data.signal >= -100 ? 2 : 1;
}

function signalText(data) {
  return signalLevel(data) ? `${data.signal} dBm` : "Tidak tersedia";
}

function statusClass(status) {
  return `badge rounded-pill ${status === "Online" ? "text-bg-success" : "text-bg-danger"}`;
}

function quotaStatus(quota) {
  if (quota > 2) return { label: "Aman", color: "success" };
  if (quota >= 1) return { label: "Peringatan", color: "warning" };
  return { label: "Kritis", color: "danger" };
}

function validateNodeData(data) {
  if (!data ||
      !["nodeId", "provider", "expiredDate", "lastUpdate"].every(
        key => typeof data[key] === "string" && data[key].trim() !== ""
      ) ||
      !["Online", "Offline"].includes(data.status) ||
      !Number.isFinite(data.quota) || data.quota < 0 ||
      !(data.signal === null || Number.isFinite(data.signal))) {
    throw new Error("Format data node tidak valid.");
  }
}

async function getNodeData() {
  const response = await fetch("/api/node/latest", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    ...data,
    lastUpdate: new Date().toLocaleTimeString("en-GB", { hour12: false })
  };
}

function renderDashboard(data) {
  const level = signalLevel(data);
  const values = {
    "node-id": data.nodeId,
    "device-status": data.status,
    provider: data.provider,
    signal: signalText(data),
    "signal-label": level ? `${["", "Sangat lemah", "Lemah", "Sedang", "Kuat"][level]} · ${level}/4 bar (dummy backend Flask)` : "0/4 bar · Sinyal tidak tersedia",
    quota: `${data.quota.toFixed(1)} GB`,
    expiry: data.expiredDate,
    "last-update": data.lastUpdate
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

function renderHistory() {
  const body = document.getElementById("history-body");
  body.replaceChildren();

  for (const reading of history) {
    const row = document.createElement("tr");
    const values = [
      reading.lastUpdate,
      reading.nodeId,
      reading.status,
      reading.provider,
      signalText(reading),
      `${reading.quota.toFixed(1)} GB`,
      reading.expiredDate
    ];

    for (const [index, value] of values.entries()) {
      const cell = document.createElement("td");
      if (index === 2) {
        const badge = document.createElement("span");
        badge.className = statusClass(reading.status);
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
  const button = document.getElementById("refresh-button");
  const message = document.getElementById("refresh-message");
  button.disabled = true;
  message.classList.remove("is-error");
  message.textContent = "Mengambil data node…";

  try {
    const data = await getNodeData();
    validateNodeData(data);
    renderDashboard(data);
    history = addHistory(history, data);
    renderHistory();
    refreshCount += 1;
    message.textContent = `Pembacaan dummy ke-${refreshCount} selesai pada ${data.lastUpdate}. Bukan data perangkat asli.`;
  } catch (error) {
    message.classList.add("is-error");
    message.textContent = history.length
      ? "Gagal mengambil data. Data sebelumnya tetap ditampilkan. Silakan coba lagi."
      : "Gagal mengambil data. Belum ada data tersedia. Silakan coba lagi.";
  } finally {
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
