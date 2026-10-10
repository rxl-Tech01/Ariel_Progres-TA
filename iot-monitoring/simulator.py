"""Simulator lokal dengan data sintetis dan database sementara, tanpa modem."""

import argparse
import json
import os
import secrets
import threading
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

from werkzeug.serving import make_server

from app import app


SCENARIOS = {
    "heartbeat": {},
    "success": {"quotaCheck": "success", "quota": 8.4, "expiredDate": None,
                "provider": "Operator simulasi", "signal": -75},
    "zero": {"quotaCheck": "success", "quota": 0, "expiredDate": None,
             "provider": "Operator simulasi", "signal": -75},
    "failed": {"quotaCheck": "failed"},
}


@contextmanager
def simulation_server(port=5001):
    """Jalankan di proses khusus; konfigurasi operasional tidak digunakan."""
    original = {key: app.config[key] for key in ("DATABASE", "NODE_ID", "SIMULATION")}
    original_token = os.environ.get("NODE_API_TOKEN")
    token = secrets.token_urlsafe(32)
    try:
        with TemporaryDirectory(prefix="quotanode-simulation-") as directory:
            app.config.update(DATABASE=Path(directory) / "simulation.sqlite3",
                              NODE_ID="SIM-NODE-001", SIMULATION=True)
            os.environ["NODE_API_TOKEN"] = token
            server = make_server("127.0.0.1", port, app)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                yield f"http://127.0.0.1:{server.server_port}", token
            finally:
                server.shutdown()
                thread.join()
                server.server_close()
    finally:
        app.config.update(original)
        if original_token is None:
            os.environ.pop("NODE_API_TOKEN", None)
        else:
            os.environ["NODE_API_TOKEN"] = original_token


def send_scenario(url, token, scenario):
    """Kirim melalui HTTP agar autentikasi, validasi, dan penyimpanan ikut diuji."""
    names = ("heartbeat", "success", "zero", "failed") if scenario == "demo" else (scenario,)
    results = []
    # Jangan arahkan lalu lintas localhost melalui proxy sistem.
    opener = build_opener(ProxyHandler({}))
    for name in names:
        payload = {"nodeId": "SIM-NODE-001", **SCENARIOS[name]}
        request = Request(url + "/api/node/update", data=json.dumps(payload).encode("utf-8"),
                          headers={"Authorization": "Bearer " + token,
                                   "Content-Type": "application/json"}, method="POST")
        with opener.open(request, timeout=5) as response:
            results.append((name, json.load(response)))
    return results


def report(url, token, scenario):
    for name, data in send_scenario(url, token, scenario):
        quota = "belum diketahui" if data["quota"] is None else f'{data["quota"]} GB'
        print(f'SIMULASI {name}: kuota={quota}; status cek={data["quota_check_status"]}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5001, help="Port lokal (default 5001)")
    parser.add_argument("--scenario", choices=("empty", "demo", *SCENARIOS), default="empty")
    parser.add_argument("--no-input", action="store_true", help="Jalankan sampai Ctrl+C tanpa menu terminal")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port harus 1–65535")
    try:
        with simulation_server(args.port) as (url, token):
            print(f"SIMULASI - bukan pengukuran perangkat. Buka {url}", flush=True)
            print("Database sementara terpisah; dihapus saat keluar normal.", flush=True)
            if args.scenario != "empty":
                report(url, token, args.scenario)
            if args.no_input:
                threading.Event().wait()
            else:
                print("Perintah: heartbeat, success, zero, failed, demo, quit. Setelah mengirim, klik Refresh Data.")
                print("Untuk menguji offline: berhenti mengirim selama lebih dari 180 detik.")
                while True:
                    command = input("simulasi> ").strip().lower()
                    if command == "quit":
                        break
                    if command not in (*SCENARIOS, "demo"):
                        print("Pilih heartbeat, success, zero, failed, demo, atau quit.")
                        continue
                    report(url, token, command)
    except (KeyboardInterrupt, EOFError):
        print("\nSimulator dihentikan.")
    except (URLError, OSError) as error:
        parser.exit(1, f"Simulator gagal ({type(error).__name__}). Periksa port dan izin folder sementara.\n")


if __name__ == "__main__":
    main()
