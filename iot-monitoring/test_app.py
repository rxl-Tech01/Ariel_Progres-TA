import os
import sqlite3
import subprocess
import sys
import unittest
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app import app, database


class AppTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database_path = Path(directory.name) / "test.sqlite3"
        for state in (
            patch.dict(app.config, DATABASE=self.database_path, NODE_ID="NODE-001"),
            patch.dict(os.environ, NODE_API_TOKEN="test-token-only"),
        ):
            state.start()
            self.addCleanup(state.stop)
        self.headers = {"Authorization": "Bearer test-token-only"}
        self.initial_data = {
            "nodeId": "NODE-001", "provider": "by.U", "signal": -75,
            "quotaCheck": "success", "quota": 8.4, "expiredDate": "24 Oktober 2026",
        }
        self.now = datetime(2026, 10, 9, tzinfo=timezone.utc)
        clock = patch("app.utc_now", return_value=self.now)
        self.clock = clock.start()
        self.addCleanup(clock.stop)

    def post(self, data):
        return self.client.post("/api/node/update", json=data, headers=self.headers)

    def latest(self):
        response = self.client.get("/api/node/latest")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_index(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        for text in ("Dashboard Monitoring", '/static/css/style.css', '/static/js/script.js', 'aria-live="polite"'):
            self.assertIn(text, html)
        self.assertNotIn("{{", html)
        self.assertIn("DEMO · DATA DUMMY", html)
        self.assertIn("Hardware belum terhubung", html)
        self.assertIn('data-demo-mode="true"', html)
        self.assertIn("Riwayat data dummy", html)
        self.assertIn("Tidak ada AT Command atau USSD yang dikirim", html)
        self.assertNotIn("test-token-only", html)

    def test_demo_presentation_does_not_change_api_or_database(self):
        self.assertEqual(self.post(self.initial_data).status_code, 200)
        original = self.database_path.read_bytes()
        html = self.client.get("/").get_data(as_text=True)
        self.assertIn("Hardware belum terhubung", html)
        self.assertEqual(self.latest()["status"], "Online")
        self.assertEqual(self.database_path.read_bytes(), original)
        with patch.dict(app.config, DEMO_MODE=False, SIMULATION=False):
            html = self.client.get("/").get_data(as_text=True)
            self.assertIn('data-demo-mode="false"', html)
            self.assertNotIn("DEMO · DATA DUMMY", html)
        with patch.dict(app.config, DEMO_MODE=False, SIMULATION=True):
            html = self.client.get("/").get_data(as_text=True)
            self.assertIn('data-demo-mode="true"', html)
            self.assertIn("Hardware belum terhubung", html)

    def test_empty_read_only(self):
        data = self.latest()
        self.assertFalse(data["hasData"])
        self.assertEqual(data["status"], "Unknown")
        for field in ("quota", "expiredDate", "received_at", "heartbeat_at", "quota_checked_at"):
            self.assertIsNone(data[field])
        self.assertFalse(self.database_path.exists())
        self.assertEqual(self.client.get("/api/node/latest").headers["Cache-Control"], "no-store")
        with closing(sqlite3.connect(self.database_path)):
            pass
        self.assertFalse(self.latest()["hasData"])

    def history(self, query=""):
        response = self.client.get("/api/node/history" + query)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("test-token-only", response.get_data(as_text=True))
        return response.get_json()

    def test_history_empty_read_only(self):
        self.assertEqual(self.history()["readings"], [])
        self.assertFalse(self.database_path.exists())
        with closing(sqlite3.connect(self.database_path)):
            pass
        original = self.database_path.read_bytes()
        self.assertEqual(self.history()["readings"], [])
        self.assertEqual(self.database_path.read_bytes(), original)

    def test_history_order_limits_and_observation_status(self):
        for quota in range(12):
            self.clock.return_value = self.now + timedelta(seconds=quota)
            self.assertEqual(self.post({**self.initial_data, "quota": quota}).status_code, 200)
        self.clock.return_value = self.now + timedelta(seconds=500)
        original = self.database_path.read_bytes()
        data = self.history()
        self.assertEqual(data["nodeId"], "NODE-001")
        self.assertEqual(data["server_time"], "2026-10-09T00:08:20Z")
        self.assertEqual([row["quota"] for row in data["readings"]], list(range(11, 1, -1)))
        self.assertEqual(data["readings"][0]["received_at"], "2026-10-09T00:00:11Z")
        self.assertEqual(data["readings"][0]["status_at_observation"], "Online")
        self.assertNotIn("status", data["readings"][0])
        self.assertEqual(self.latest()["status"], "Offline")
        self.assertEqual(len(self.history("?limit=1")["readings"]), 1)
        self.assertEqual(len(self.history("?limit=100")["readings"]), 12)
        self.assertEqual(self.history(), data)
        self.assertEqual(self.database_path.read_bytes(), original)
        for method in ("post", "put", "patch", "delete"):
            self.assertEqual(getattr(self.client, method)("/api/node/history").status_code, 405)
        self.assertEqual(self.database_path.read_bytes(), original)

    def test_history_invalid_limits(self):
        for value in ("", "0", "101", "-1", "1.5", "abc", "1e1", "+1", " 1", "１２", "9" * 5000):
            with self.subTest(value=value):
                response = self.client.get("/api/node/history", query_string={"limit": value})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/node/history?limit=1&limit=2").status_code, 400)
        self.assertFalse(self.database_path.exists())

    def test_history_scope_legacy_and_nullable(self):
        self.legacy_database()
        original = self.database_path.read_bytes()
        rows = self.history("?nodeId=NODE-OTHER")["readings"]
        self.assertEqual([row["nodeId"] for row in rows], ["NODE-001"])
        self.assertIsNone(rows[0]["heartbeat_at"])
        self.assertEqual(self.database_path.read_bytes(), original)
        with patch.dict(app.config, NODE_ID="NODE-OTHER"):
            self.assertEqual(self.history()["readings"][0]["quota"], 99)
        with patch.dict(app.config, NODE_ID="NODE-NEW"):
            self.assertEqual(self.history()["readings"], [])
            self.assertEqual(self.post({"nodeId": "NODE-NEW", "quotaCheck": "failed"}).status_code, 200)
            row = self.history()["readings"][0]
            self.assertIsNone(row["quota"])
            self.assertIsNone(row["quota_checked_at"])
            self.assertEqual(row["quota_check_status"], "failed")

    def test_authentication(self):
        for authorization in (None, "", "Bearer wrong", "Basic test-token-only", "Bearer tést"):
            headers = {} if authorization is None else {"Authorization": authorization}
            response = self.client.post("/api/node/update", json=self.initial_data, headers=headers)
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("test-token-only", response.get_data(as_text=True))
        for token in ("", "   "):
            with patch.dict(os.environ, NODE_API_TOKEN=token):
                self.assertEqual(self.post(self.initial_data).status_code, 503)
        with patch.dict(os.environ):
            os.environ.pop("NODE_API_TOKEN", None)
            self.assertEqual(self.post(self.initial_data).status_code, 503)
        self.assertFalse(self.database_path.exists())
        with patch("app.hmac.compare_digest", wraps=__import__("hmac").compare_digest) as compare:
            self.assertEqual(self.post(self.initial_data).status_code, 200)
            compare.assert_called_once()

    def test_zero_heartbeat_and_failed_check(self):
        success = self.post({**self.initial_data, "quota": 0, "expiredDate": None}).get_json()
        self.assertTrue(success["hasData"])
        self.assertEqual(success, self.latest())
        self.assertEqual(success["quota"], 0)
        self.assertEqual(success["received_at"], success["quota_checked_at"])
        for seconds, payload, state in (
            (60, {"nodeId": "NODE-001"}, "success"),
            (120, {"nodeId": "NODE-001", "quotaCheck": "failed"}, "failed"),
            (180, {"nodeId": "NODE-001", "signal": None}, "failed"),
        ):
            self.clock.return_value = self.now + timedelta(seconds=seconds)
            response = self.post(payload)
            self.assertEqual(response.status_code, 200)
            data = response.get_json()
            self.assertEqual(data["quota"], 0)
            self.assertIsNone(data["expiredDate"])
            self.assertEqual(data["quota_checked_at"], success["quota_checked_at"])
            self.assertEqual(data["quota_check_status"], state)
            self.assertNotEqual(data["received_at"], success["received_at"])
            self.assertEqual(data, self.latest())
        recovered = self.post(self.initial_data).get_json()
        self.assertEqual(recovered["quota_check_status"], "success")
        self.assertNotEqual(recovered["quota_checked_at"], success["quota_checked_at"])

    def test_unknown_quota_and_timeout(self):
        self.assertEqual(self.post({"nodeId": "NODE-001"}).status_code, 200)
        for seconds, status in ((0, "Online"), (180, "Online"), (180.001, "Offline")):
            self.clock.return_value = self.now + timedelta(seconds=seconds)
            data = self.latest()
            self.assertEqual(data["status"], status)
            self.assertIsNone(data["quota"])
            self.assertIsNone(data["quota_checked_at"])
        failed = self.post({"nodeId": "NODE-001", "quotaCheck": "failed"}).get_json()
        self.assertIsNone(failed["quota"])
        self.assertEqual(failed["quota_check_status"], "failed")

    def test_invalid_update_preserves_data(self):
        self.assertEqual(self.post(self.initial_data).status_code, 200)
        saved = self.latest()
        invalid = [None, [], "text", {}, {**self.initial_data, "extra": 1},
                   {"nodeId": "NODE-001", "quota": 1},
                   {"nodeId": "NODE-001", "quotaCheck": "failed", "expiredDate": None}]
        for field in ("nodeId", "quota", "expiredDate"):
            invalid.append({key: value for key, value in self.initial_data.items() if key != field})
        for field, values in (
            ("nodeId", ["", "NODE-002", None, []]),
            ("provider", ["", "  ", 123, "x" * 129]),
            ("expiredDate", ["  ", 123, []]),
            ("quotaCheck", ["unknown", [], {}, None, True]),
            ("quota", [-1, "1.5", True, None, float("nan"), float("inf"), 10 ** 400]),
            ("signal", ["-85", False, [], float("nan"), float("inf"), -10 ** 400]),
        ):
            invalid.extend({**self.initial_data, field: value} for value in values)
        for data in invalid:
            with self.subTest(data=data):
                response = self.client.post("/api/node/update", data=app.json.dumps(data),
                                            content_type="application/json", headers=self.headers)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.latest(), saved)
        with closing(sqlite3.connect(self.database_path)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM readings").fetchone()[0], 1)

    def test_invalid_request_preserves_data(self):
        for body, content_type, status in (
            ('{"quota":', "application/json", 400), ("", "application/json", 400),
            ("{}", "text/plain", 415), ("x" * 17000, "application/json", 413),
        ):
            response = self.client.post("/api/node/update", data=body, content_type=content_type, headers=self.headers)
            self.assertEqual(response.status_code, status)
            self.assertFalse(self.latest()["hasData"])

    def legacy_database(self):
        with closing(sqlite3.connect(self.database_path)) as connection, connection:
            connection.execute("""CREATE TABLE readings (
                id INTEGER PRIMARY KEY, nodeId TEXT NOT NULL, status TEXT NOT NULL,
                provider TEXT NOT NULL, quota REAL NOT NULL CHECK (quota >= 0), signal REAL,
                expiredDate TEXT NOT NULL, received_at TEXT NOT NULL
            )""")
            connection.executemany("INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
                (7, "NODE-001", "Online", "by.U", 0, -75, "lama", "2026-01-01T00:00:00.123Z"),
                (9, "NODE-OTHER", "Online", "other", 99, -80, "other", "2026-02-01T00:00:00Z"),
            ])

    def test_migration_preserves_rows_and_scope(self):
        self.legacy_database()
        with closing(sqlite3.connect(self.database_path)) as connection:
            original = connection.execute("SELECT * FROM readings ORDER BY id").fetchall()
            schema = connection.execute("SELECT sql FROM sqlite_master WHERE name='readings'").fetchone()
        legacy = self.latest()
        self.assertEqual(legacy["quota"], 0)
        self.assertEqual(legacy["status"], "Offline")
        self.assertIsNone(legacy["heartbeat_at"])
        self.assertIsNone(legacy["quota_checked_at"])
        with closing(sqlite3.connect(self.database_path)) as connection:
            self.assertEqual(connection.execute("SELECT sql FROM sqlite_master WHERE name='readings'").fetchone(), schema)
        self.assertEqual(self.post({"nodeId": "NODE-001"}).status_code, 200)
        with closing(sqlite3.connect(self.database_path)) as connection:
            rows = connection.execute("SELECT * FROM readings ORDER BY id").fetchall()
        self.assertEqual([row[:8] for row in rows[:2]], original)
        self.assertTrue(all(row[8:] == (None, None, "unknown") for row in rows[:2]))
        self.assertIsNone(self.latest()["quota_checked_at"])
        with patch.dict(app.config, NODE_ID="NODE-OTHER"):
            self.assertEqual(self.latest()["quota"], 99)
            self.assertEqual(self.post({"nodeId": "NODE-001"}).status_code, 400)
        with patch.dict(app.config, NODE_ID="NODE-NEW"):
            self.assertFalse(self.latest()["hasData"])
            self.assertEqual(self.post({"nodeId": "NODE-NEW"}).status_code, 200)
            self.assertIsNone(self.latest()["quota"])

    def test_migration_rolls_back(self):
        self.legacy_database()
        with self.assertRaises(sqlite3.OperationalError):
            with database(write=True) as connection:
                connection.execute("INSERT INTO missing_table VALUES (1)")
        with closing(sqlite3.connect(self.database_path)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM readings").fetchone()[0], 2)
            self.assertNotIn("quota_checked_at", [row[1] for row in connection.execute("PRAGMA table_info(readings)")])
            self.assertIsNone(connection.execute("SELECT name FROM sqlite_master WHERE name='readings_phase1'").fetchone())

    def test_readings_persist_across_processes(self):
        for quota in (2.5, 1.5):
            self.assertEqual(self.post({**self.initial_data, "quota": quota}).status_code, 200)
        result = subprocess.run(
            [sys.executable, "-B", "-c",
             "import sys; from app import app; app.config['DATABASE'] = sys.argv[1]; "
             "app.config['NODE_ID'] = 'NODE-001'; "
             "response = app.test_client().get('/api/node/history'); "
             "assert response.status_code == 200; print(response.get_data(as_text=True))",
             str(self.database_path)],
            cwd=app.root_path, capture_output=True, text=True, check=True, timeout=15,
        )
        self.assertEqual([row["quota"] for row in app.json.loads(result.stdout)["readings"]], [1.5, 2.5])
        with closing(sqlite3.connect(self.database_path)) as connection:
            rows = connection.execute("SELECT quota, received_at FROM readings ORDER BY id").fetchall()
        self.assertEqual([row[0] for row in rows], [2.5, 1.5])
        self.assertTrue(all(row[1].endswith("Z") for row in rows))

    def test_database_error_does_not_report_success(self):
        self.assertEqual(self.post(self.initial_data).status_code, 200)
        saved = self.latest()
        with patch.dict(app.config, DATABASE=self.database_path.parent / "missing" / "db.sqlite3"):
            with self.assertLogs(app.logger, level="ERROR") as logs:
                for response in (self.post(self.initial_data), self.client.get("/api/node/latest"),
                                 self.client.get("/api/node/history")):
                    self.assertEqual(response.status_code, 503)
                    self.assertIn("error", response.get_json())
                    self.assertNotIn("test-token-only", response.get_data(as_text=True))
            self.assertNotIn("test-token-only", str(logs.output))
        with closing(sqlite3.connect(self.database_path)) as connection, connection:
            connection.execute("""CREATE TRIGGER reject_insert BEFORE INSERT ON readings
                                  BEGIN SELECT RAISE(ABORT, 'test failure'); END""")
        with self.assertLogs(app.logger, level="ERROR"):
            self.assertEqual(self.post({**self.initial_data, "quota": 0}).status_code, 503)
        self.assertEqual(self.latest(), saved)

    def test_static(self):
        for path, content_type in (("/static/css/style.css", "text/css"), ("/static/js/script.js", "javascript")):
            with self.client.get(path) as response:
                self.assertEqual(response.status_code, 200)
                self.assertIn(content_type, response.content_type)
                self.assertTrue(response.get_data())
                self.assertNotIn(b"test-token-only", response.get_data())


if __name__ == "__main__":
    unittest.main()
