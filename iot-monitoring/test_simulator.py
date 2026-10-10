import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.request import ProxyHandler, build_opener

from app import app
from simulator import send_scenario, simulation_server


class SimulationTests(unittest.TestCase):
    def test_http_scenarios_isolate_data_and_restore_configuration(self):
        with TemporaryDirectory() as directory:
            operational = Path(directory) / "operational.sqlite3"
            operational.write_bytes(b"operational database must not be opened")
            with patch.dict(app.config, DATABASE=operational, NODE_ID="REAL-NODE", SIMULATION=False), \
                    patch.dict(os.environ, NODE_API_TOKEN="original-test-token"):
                with simulation_server(port=0) as (url, token):
                    temporary = app.config["DATABASE"]
                    self.assertNotEqual(temporary, operational)
                    opener = build_opener(ProxyHandler({}))
                    with opener.open(url + "/api/node/latest", timeout=5) as response:
                        self.assertFalse(json.load(response)["hasData"])
                    self.assertFalse(temporary.exists())
                    with opener.open(url, timeout=5) as response:
                        html = response.read().decode("utf-8")
                        self.assertIn("SIMULASI", html)
                        self.assertNotIn(token, html)
                    results = dict(send_scenario(url, token, "demo"))
                    self.assertIsNone(results["heartbeat"]["quota"])
                    self.assertEqual(results["success"]["quota"], 8.4)
                    self.assertEqual(results["zero"]["quota"], 0)
                    self.assertEqual(results["failed"]["quota"], 0)
                    self.assertEqual(results["failed"]["quota_check_status"], "failed")
                    self.assertEqual(results["failed"]["quota_checked_at"], results["zero"]["quota_checked_at"])
                    with opener.open(url + "/api/node/history", timeout=5) as response:
                        rows = json.load(response)["readings"]
                    self.assertEqual(len(rows), 4)
                    self.assertTrue(all(row["nodeId"] == "SIM-NODE-001" for row in rows))
                    self.assertEqual(operational.read_bytes(), b"operational database must not be opened")
                self.assertFalse(temporary.exists())
                self.assertEqual(app.config["DATABASE"], operational)
                self.assertEqual(app.config["NODE_ID"], "REAL-NODE")
                self.assertFalse(app.config["SIMULATION"])
                self.assertEqual(os.environ["NODE_API_TOKEN"], "original-test-token")


if __name__ == "__main__":
    unittest.main()
