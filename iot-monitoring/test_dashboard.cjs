const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function dashboard(demoMode = false) {
  const element = (tag = "div") => ({
    tagName: tag, dataset: {},
    textContent: "", className: "", children: [], classList: { remove() {}, add() {} },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this[name] = value; },
    toggleAttribute(name, force) { this[name] = Boolean(force); },
    replaceChildren() { this.children = []; }, addEventListener() {},
    querySelectorAll() {
      const found = [];
      const walk = node => { if (node.tagName === "details" && node.open) found.push(node); node.children.forEach(walk); };
      this.children.forEach(walk);
      return found;
    }
  });
  const elements = new Map();
  const document = {
    body: { dataset: { demoMode: String(demoMode) } },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    createElementNS(namespace, tag) { return element(tag); }
  };
  const context = vm.createContext({
    document, console, Intl, AbortController,
    fetch: () => new Promise(() => {}), setTimeout() {}, clearTimeout() {}, setInterval() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "static/js/script.js"), "utf8"), context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

test("WIB and quota age use server time, including unknown and future timestamps", () => {
  const { run } = dashboard();
  assert.match(run('formatTime("2026-10-09T20:30:00Z")'), /10 Okt 2026.*03[.:]30[.:]00 WIB/);
  assert.equal(run("formatTime(null)"), "Belum diketahui");
  assert.match(run('quotaAge(null, "2026-10-10T00:00:00Z")'), /Belum ada/);
  for (const [time, expected] of [["00:00:00", "0 detik"], ["00:01:00", "1 menit"], ["02:00:00", "2 jam"]]) {
    assert.ok(run(`quotaAge("2026-10-10T00:00:00Z", "2026-10-10T${time}Z")`).includes(expected));
  }
  assert.match(run('quotaAge("2026-10-08T00:00:00Z", "2026-10-10T00:00:00Z")'), /2 hari/);
  assert.match(run('quotaAge("2026-10-11T00:00:00Z", "2026-10-10T00:00:00Z")'), /belum dapat dihitung/);
});

test("demo Online data never claims hardware connection, including after refresh", () => {
  const { context, elements, run } = dashboard(true);
  context.reading = {
    hasData: true, nodeId: "NODE-001", status: "Online", status_at_observation: "Online",
    provider: "Operator contoh", signal: -75, quota: 8.4, expiredDate: null,
    quota_check_status: "success", quota_checked_at: "2026-10-14T00:00:00Z",
    received_at: "2026-10-14T00:00:00Z", server_time: "2026-10-14T00:00:30Z"
  };
  run("renderDashboard(reading); renderHistory([reading]); renderDashboard(reading)");
  assert.equal(elements.get("device-status").textContent, "Hardware belum terhubung");
  assert.equal(elements.get("device-status").className, "badge text-bg-secondary");
  assert.equal(elements.get("quota-status").textContent, "Aman (contoh)");
  assert.equal(elements.get("check-status").textContent, "Berhasil (simulasi)");
  const cells = elements.get("history-body").children[0].children;
  assert.equal(cells[2].children[0].textContent, "Online (simulasi)");
  assert.equal(cells[6].children[0].textContent, "Berhasil (simulasi)");
  context.reading.hasData = false;
  context.reading.status = "Unknown";
  run("renderDashboard(reading)");
  assert.equal(elements.get("device-status").textContent, "Hardware belum terhubung");
});

test("trends preserve zero, omit unknown quota, and deduplicate heartbeat readings", () => {
  const { context, run, elements } = dashboard();
  context.history = [
    { quota: 0, signal: -80, received_at: "2026-10-10T02:00:00Z", quota_checked_at: "2026-10-10T01:00:00Z" },
    { quota: 0, signal: -75, received_at: "2026-10-10T01:00:00Z", quota_checked_at: "2026-10-10T01:00:00Z" },
    { quota: 1, signal: null, received_at: "2026-10-10T00:00:00Z", quota_checked_at: "2026-10-10T00:00:00Z" },
    { quota: null, signal: null, received_at: "2026-10-09T23:00:00Z", quota_checked_at: null }
  ];
  assert.equal(run('JSON.stringify(trendSeries(history, "quota").map(point => point.value))'), "[1,0]");
  assert.equal(run('trendSeries(history, "signal").length'), 2);
  run("renderTrends(history)");
  assert.equal(elements.get("quota-chart").hidden, false);
  assert.equal(elements.get("quota-chart-empty").hidden, true);
  const points = elements.get("quota-chart").children.filter(child => child.tagName === "circle");
  assert.equal(points.length, 2);
  assert.equal(points[1].cy, 152);
  assert.match(points[1].children[0].textContent, /0 GB/);
  run("renderTrends([])");
  assert.equal(elements.get("quota-chart").hidden, true);
  assert.equal(elements.get("quota-chart-empty").hidden, false);
});

test("failed check retains zero and its successful reading time in card and history", () => {
  const { context, elements, run } = dashboard();
  context.reading = {
    hasData: true, nodeId: "SIM-NODE-001", status: "Offline", status_at_observation: "Online",
    provider: "Operator simulasi", signal: -75, quota: 0, expiredDate: null,
    quota_check_status: "failed", quota_checked_at: "2026-10-10T00:00:00Z",
    received_at: "2026-10-10T01:00:00Z", server_time: "2026-10-10T02:00:00Z"
  };
  run("renderDashboard(reading); renderHistory([reading]);");
  assert.equal(elements.get("quota").textContent, "0.0 GB");
  assert.equal(elements.get("device-status").textContent, "Tidak terhubung");
  assert.equal(elements.get("check-status").textContent, "Gagal");
  assert.match(elements.get("quota-time").textContent, /07[.:]00[.:]00 WIB/);
  assert.match(elements.get("quota-age").textContent, /2 jam/);
  const cells = elements.get("history-body").children[0].children;
  assert.equal(cells.length, 9);
  assert.equal(cells[2].children[0].textContent, "Terhubung");
  assert.equal(cells[5].textContent, "0.0 GB");
  assert.equal(cells[6].children[0].textContent, "Gagal");
  assert.match(cells[7].textContent, /07[.:]00[.:]00 WIB/);
  const card = elements.get("history-cards").children[0];
  assert.equal(card.children[0].children[1].textContent, "0.0 GB");
  assert.equal(card.children[1].children[1].children[0].textContent, "Gagal");
  const detail = card.children[2];
  detail.open = true;
  run("renderHistory([reading])");
  assert.equal(elements.get("history-cards").children[0], card, "unchanged polling preserves DOM and focus");
  context.reading.provider = "<script>example</script>";
  run("renderHistory([reading])");
  const updatedDetail = elements.get("history-cards").children[0].children[2];
  assert.equal(updatedDetail.open, true);
  assert.equal(updatedDetail.children[1].children[3].textContent, "<script>example</script>");
  assert.match(updatedDetail.children[1].children[7].textContent, /07[.:]00[.:]00 WIB/);
  run("renderHistory([])");
  assert.equal(elements.get("history-body").children[0].children[0].colSpan, 9);
  assert.match(elements.get("history-cards").children[0].textContent, /Belum ada riwayat/);
});


test("refresh reads both APIs and failed refresh preserves the last displayed data", async () => {
  const { context, elements, run } = dashboard(true);
  const calls = [];
  const reading = {
    nodeId: "NODE-001", hasData: true, status: "Online", provider: "Operator simulasi",
    signal: -75, quota: 0, expiredDate: null, received_at: "2026-11-01T00:00:00Z",
    heartbeat_at: "2026-11-01T00:00:00Z", quota_checked_at: "2026-11-01T00:00:00Z",
    quota_check_status: "failed", server_time: "2026-11-01T00:00:01Z"
  };
  context.fetch = async (url, options) => {
    calls.push({ url, method: options.method ?? "GET" });
    return { ok: true, json: async () => url.endsWith("latest") ? reading
      : { nodeId: reading.nodeId, readings: [], server_time: reading.server_time } };
  };
  run("refreshing = false");
  await run("refreshData()");
  assert.deepEqual(calls, [
    { url: "/api/node/latest", method: "GET" }, { url: "/api/node/history", method: "GET" }
  ]);
  assert.equal(elements.get("quota").textContent, "0.0 GB");
  const received = elements.get("last-update").textContent;
  context.fetch = async () => { throw new Error("connection unavailable"); };
  await run("refreshData()");
  assert.equal(elements.get("quota").textContent, "0.0 GB");
  assert.equal(elements.get("last-update").textContent, received);
  assert.match(elements.get("refresh-message").textContent, /Data sebelumnya tetap ditampilkan/);
  assert.equal(elements.get("refresh-button").disabled, false);
});

test("an unavailable API on first load reports failure without inventing measurements", async () => {
  const { context, elements, run } = dashboard(true);
  context.fetch = async () => ({ ok: false, status: 503 });
  run("refreshing = false");
  await run("refreshData()");
  assert.match(elements.get("refresh-message").textContent, /Belum ada data tersedia/);
  assert.equal(elements.get("refresh-button").disabled, false);
  assert.equal(elements.has("quota"), false);
});
