import hmac
import os
import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from sys import float_info

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["DATABASE"] = Path(app.root_path) / "monitoring.sqlite3"
app.config["NODE_ID"] = os.environ.get("NODE_ID", "NODE-001")
app.config["MAX_CONTENT_LENGTH"] = 16384
app.config["SIMULATION"] = False
# Prototipe saat ini belum terhubung ke hardware. Terpisah dari isolasi DB simulator.
app.config["DEMO_MODE"] = True


def utc_now():
    return datetime.now(timezone.utc)


@contextmanager
def database(write=False):
    path = Path(app.config["DATABASE"])
    target = str(path) if write else path.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(target, uri=not write)) as connection:
        connection.row_factory = sqlite3.Row
        with connection:
            if write:
                connection.execute("BEGIN IMMEDIATE")
                columns = connection.execute("PRAGMA table_info(readings)").fetchall()
                if not columns or "quota_checked_at" not in {row["name"] for row in columns}:
                    connection.execute("""
                        CREATE TABLE readings_phase1 (
                            id INTEGER PRIMARY KEY,
                            nodeId TEXT NOT NULL,
                            status TEXT NOT NULL CHECK (status IN ('Online', 'Offline')),
                            provider TEXT,
                            quota REAL CHECK (quota >= 0),
                            signal REAL,
                            expiredDate TEXT,
                            received_at TEXT NOT NULL,
                            heartbeat_at TEXT,
                            quota_checked_at TEXT,
                            quota_check_status TEXT NOT NULL DEFAULT 'unknown'
                                CHECK (quota_check_status IN ('unknown', 'success', 'failed'))
                        )
                    """)
                    if columns:
                        connection.execute("""
                            INSERT INTO readings_phase1
                                (id, nodeId, status, provider, quota, signal, expiredDate, received_at)
                            SELECT id, nodeId, status, provider, quota, signal, expiredDate, received_at
                            FROM readings
                        """)
                        connection.execute("DROP TABLE readings")
                    connection.execute("ALTER TABLE readings_phase1 RENAME TO readings")
            yield connection


def latest_reading(connection):
    row = connection.execute(
        "SELECT * FROM readings WHERE nodeId = ? ORDER BY id DESC LIMIT 1",
        (app.config["NODE_ID"],),
    ).fetchone()
    return dict(row) if row else None


def node_response(reading):
    now = utc_now()
    result = {
        "nodeId": app.config["NODE_ID"], "hasData": reading is not None,
        "status": "Unknown", "provider": None, "quota": None, "signal": None,
        "expiredDate": None, "received_at": None, "heartbeat_at": None,
        "quota_checked_at": None, "quota_check_status": "unknown",
        "server_time": now.isoformat().replace("+00:00", "Z"),
    }
    if reading:
        result.update({key: reading[key] for key in result
                       if key in reading and key not in {"hasData", "server_time", "nodeId", "status"}})
        heartbeat = result["heartbeat_at"]
        result["status"] = "Offline"
        if heartbeat:
            age = (now - datetime.fromisoformat(heartbeat.replace("Z", "+00:00"))).total_seconds()
            if 0 <= age <= 180:
                result["status"] = "Online"
    return result


@app.errorhandler(sqlite3.Error)
def database_error(error):
    app.logger.error("Operasi database gagal (%s).", type(error).__name__)
    return jsonify({"error": "Database tidak tersedia. Coba lagi nanti."}), 503


@app.get("/")
def index():
    return render_template("index.html", simulation=app.config["SIMULATION"],
                           demo_mode=app.config["DEMO_MODE"] or app.config["SIMULATION"])


@app.get("/api/node/latest")
def latest_node():
    reading = None
    path = Path(app.config["DATABASE"])
    if not path.parent.is_dir():
        raise sqlite3.OperationalError("Database directory unavailable")
    if path.exists():
        with database() as connection:
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'readings'").fetchone():
                reading = latest_reading(connection)
    response = jsonify(node_response(reading))
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/node/history")
def node_history():
    limits = request.args.getlist("limit")
    raw_limit = limits[0] if limits else "10"
    if len(limits) > 1 or not raw_limit.isascii() or not raw_limit.isdecimal() or len(raw_limit) > 3:
        return jsonify({"error": "limit harus bilangan bulat 1–100."}), 400
    limit = int(raw_limit)
    if not 1 <= limit <= 100:
        return jsonify({"error": "limit harus bilangan bulat 1–100."}), 400
    readings = []
    path = Path(app.config["DATABASE"])
    if not path.parent.is_dir():
        raise sqlite3.OperationalError("Database directory unavailable")
    if path.exists():
        with database() as connection:
            if connection.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'readings'").fetchone():
                rows = connection.execute(
                    "SELECT * FROM readings WHERE nodeId = ? ORDER BY id DESC LIMIT ?",
                    (app.config["NODE_ID"], limit),
                ).fetchall()
                for row in rows:
                    reading = node_response(dict(row))
                    reading["status_at_observation"] = row["status"]
                    del reading["status"]
                    del reading["server_time"]
                    readings.append(reading)
    response = jsonify(nodeId=app.config["NODE_ID"], readings=readings,
                       server_time=utc_now().isoformat().replace("+00:00", "Z"))
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/node/update")
def update_node():
    token = os.environ.get("NODE_API_TOKEN", "")
    if not token.strip():
        return jsonify({"error": "Penerimaan data belum dikonfigurasi."}), 503
    authorization = request.headers.get("Authorization", "")
    if not hmac.compare_digest(authorization.encode("utf-8"), ("Bearer " + token).encode("utf-8")):
        return jsonify({"error": "Autentikasi gagal."}), 401
    if not request.is_json:
        return jsonify({"error": "Gunakan Content-Type application/json."}), 415
    data = request.get_json(silent=True)
    allowed = {"nodeId", "provider", "signal", "quotaCheck", "quota", "expiredDate"}
    if not isinstance(data, dict) or "nodeId" not in data or set(data) - allowed:
        return jsonify({"error": "Field JSON tidak valid."}), 400
    if data["nodeId"] != app.config["NODE_ID"]:
        return jsonify({"error": "nodeId tidak sesuai konfigurasi."}), 400
    check = data.get("quotaCheck")
    if "quotaCheck" in data and check not in ("success", "failed"):
        return jsonify({"error": "quotaCheck harus success atau failed."}), 400
    if check == "success":
        quota = data.get("quota")
        if type(quota) not in (int, float) or not 0 <= quota <= float_info.max or "expiredDate" not in data:
            return jsonify({"error": "Cek sukses memerlukan quota terbatas >= 0 dan expiredDate."}), 400
    elif "quota" in data or "expiredDate" in data:
        return jsonify({"error": "quota dan expiredDate hanya untuk cek sukses."}), 400
    for field in ("provider", "expiredDate"):
        value = data.get(field)
        if value is not None and (not isinstance(value, str) or not value.strip() or len(value) > 128):
            return jsonify({"error": f"{field} harus teks 1–128 karakter atau null."}), 400
    signal = data.get("signal")
    if signal is not None and (type(signal) not in (int, float) or not -float_info.max <= signal <= float_info.max):
        return jsonify({"error": "signal harus angka terbatas atau null."}), 400
    with database(write=True) as connection:
        previous = latest_reading(connection)
        reading = node_response(previous)
        now = utc_now().isoformat().replace("+00:00", "Z")
        reading.update(status="Online", received_at=now, heartbeat_at=now)
        for field in ("provider", "signal"):
            if field in data:
                reading[field] = data[field]
        if check:
            reading["quota_check_status"] = check
        if check == "success":
            reading.update(quota=float(data["quota"]), expiredDate=data["expiredDate"], quota_checked_at=now)
        connection.execute("""
            INSERT INTO readings (nodeId, status, provider, quota, signal, expiredDate,
                                  received_at, heartbeat_at, quota_checked_at, quota_check_status)
            VALUES (:nodeId, :status, :provider, :quota, :signal, :expiredDate,
                    :received_at, :heartbeat_at, :quota_checked_at, :quota_check_status)
        """, reading)
    return jsonify(node_response(reading))


if __name__ == "__main__":
    app.run(host="127.0.0.1", debug=False)
