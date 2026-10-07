import unittest

from app import app


class AppTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_index(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn("Dashboard Monitoring", html)
        self.assertIn('/static/css/style.css', html)
        self.assertIn('/static/js/script.js', html)
        self.assertNotIn("{{", html)

    def test_latest_node(self):
        response = self.client.get("/api/node/latest")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.is_json)
        self.assertEqual(response.get_json(), {
            "nodeId": "NODE-001",
            "status": "Online",
            "provider": "by.U",
            "quota": 8.4,
            "signal": -75,
            "expiredDate": "24 Oktober 2026",
        })

    def test_static(self):
        for path, content_type in (
            ("/static/css/style.css", "text/css"),
            ("/static/js/script.js", "javascript"),
        ):
            with self.subTest(path=path):
                with self.client.get(path) as response:
                    self.assertEqual(response.status_code, 200)
                    self.assertIn(content_type, response.content_type)
                    self.assertTrue(response.get_data())


if __name__ == "__main__":
    unittest.main()
