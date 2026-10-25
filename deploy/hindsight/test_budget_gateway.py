"""No paid calls: exercise the gateway over HTTP with an isolated ledger."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request


class GatewayTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="devflow-budget-test-")
        self.root = Path(self.directory.name)
        spec = importlib.util.spec_from_file_location(
            "gateway", Path(__file__).with_name("budget_gateway.py"))
        self.gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.gateway)
        self.gateway.UPSTREAM = "http://127.0.0.1:1/v1/chat/completions"
        self.gateway.ROOT = self.root
        self.gateway.KEY_FILE = self.root / "test-key"
        self.gateway.KEY_FILE.write_text("sk-synthetic-never-forwarded")
        self.ledger = {
            "budget_microyuan": 5000000, "closed": False,
            "calls": [{"id": 1, "reserved_microyuan": 4999999,
                       "status": "reserved_unknown"}],
        }
        (self.root / "ledger.json").write_text(json.dumps(self.ledger))
        self.server = self.gateway.ThreadingHTTPServer(
            ("127.0.0.1", 0), self.gateway.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, path, data=None):
        body = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(self.url + path, data=body,
                                         headers={"Content-Type": "application/json"})
        try:
            with self.http.open(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    def test_exhausted_five_yuan_budget_refuses_before_forwarding(self):
        status, body = self.request("/v1/chat/completions", {
            "model": "deepseek-flash",
            "messages": [{"role": "user", "content": "Synthetic Cedar refund rule"}],
        })
        self.assertEqual(status, 402)
        self.assertIn("5", body["error"]["message"])
        status, budget = self.request("/budget")
        self.assertEqual(status, 200)
        self.assertEqual(budget["budget_cny"], 5)
        self.assertEqual(budget["calls"], 1)
        self.assertEqual(budget["committed_upper_bound_cny"], 4.999999)

    def test_remaining_budget_requires_a_strict_positive_integer_and_blocks_over_reservation(self):
        self.assertEqual(self.gateway.parse_budget_microyuan("4949398"), 4949398)
        for invalid in ("0", "-1", "5.0", " 5000000", "5000000 ", "5000001", "05", "true"):
            with self.subTest(invalid=invalid), self.assertRaises(self.gateway.BudgetError):
                self.gateway.parse_budget_microyuan(invalid)
        self.gateway.BUDGET_MICROYUAN = 4949398
        self.ledger["budget_microyuan"] = 4949398
        self.ledger["calls"] = [{"id": 1, "reserved_microyuan": 4949397,
                                 "status": "reserved_unknown"}]
        (self.root / "ledger.json").write_text(json.dumps(self.ledger))
        status, _ = self.request("/v1/chat/completions", {
            "model": "deepseek-flash", "messages": [{"role": "user", "content": "Synthetic"}],
        })
        self.assertEqual(status, 402)
        _, budget = self.request("/budget")
        self.assertEqual(budget["budget_cny"], 4.949398)
        self.assertEqual(budget["calls"], 1)
        # A restarted process using the old default cannot enlarge this ledger.
        self.gateway.BUDGET_MICROYUAN = 5000000
        status, _ = self.request("/budget")
        self.assertEqual(status, 503)

    def test_initialization_uses_the_remaining_cap_and_never_overwrites_or_reopens_a_ledger(self):
        state = self.root / "continuation"
        script = Path(__file__).with_name("budget_gateway.py")
        env = {**os.environ, "GATEWAY_STATE_DIR": str(state),
               "DEVFLOW_HINDSIGHT_TEST_AUTHORIZED": "1",
               "DEVFLOW_HINDSIGHT_TEST_BUDGET_MICROYUAN": "4949398"}
        def run(*args):
            return subprocess.run([sys.executable, str(script), *args], env=env,
                                  capture_output=True, text=True, timeout=10)
        self.assertEqual(run("--initialize").returncode, 0)
        ledger_path = state / "ledger.json"
        initial = ledger_path.read_bytes()
        self.assertEqual(json.loads(initial)["budget_microyuan"], 4949398)
        self.assertNotEqual(run("--initialize").returncode, 0)
        self.assertEqual(ledger_path.read_bytes(), initial)
        self.assertEqual(run("--close").returncode, 0)
        closed = ledger_path.read_bytes()
        self.assertTrue(json.loads(closed)["closed"])
        self.assertNotEqual(run("--initialize").returncode, 0)
        self.assertEqual(ledger_path.read_bytes(), closed)
        # A malformed or larger cap fails before any new ledger is created.
        env["GATEWAY_STATE_DIR"] = str(self.root / "invalid-cap")
        env["DEVFLOW_HINDSIGHT_TEST_BUDGET_MICROYUAN"] = "5000001"
        self.assertNotEqual(run("--initialize").returncode, 0)
        self.assertFalse((self.root / "invalid-cap" / "ledger.json").exists())

    def test_closed_test_authorization_cannot_be_reused(self):
        self.ledger.update(closed=True, calls=[])
        (self.root / "ledger.json").write_text(json.dumps(self.ledger))
        # Any accidental forwarding goes to an unused loopback port, never a paid API.
        self.gateway.UPSTREAM = "http://127.0.0.1:1/v1/chat/completions"
        status, _ = self.request("/v1/chat/completions", {
            "model": "deepseek-flash", "messages": [{"role": "user", "content": "Synthetic"}],
        })
        self.assertEqual(status, 402)
        status, budget = self.request("/budget")
        self.assertEqual(status, 200)
        self.assertTrue(budget["closed"])
        self.assertEqual(budget["calls"], 0)

    def test_unknown_provider_failure_keeps_reservation_across_restart(self):
        self.ledger["calls"] = []
        (self.root / "ledger.json").write_text(json.dumps(self.ledger))
        status, _ = self.request("/v1/chat/completions", {
            "model": "deepseek-flash", "messages": [{"role": "user", "content": "Synthetic"}],
        })
        self.assertEqual(status, 502)
        _, before = self.request("/budget")
        self.assertEqual(before["unknown_calls"], 1)
        self.assertGreater(before["committed_upper_bound_cny"], 0)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.server = self.gateway.ThreadingHTTPServer(("127.0.0.1", 0), self.gateway.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        _, after = self.request("/budget")
        self.assertEqual(after["calls"], 1)
        self.assertEqual(after["committed_upper_bound_cny"], before["committed_upper_bound_cny"])

    def test_missing_ledger_and_different_model_fail_without_forwarding(self):
        status, _ = self.request("/v1/chat/completions", {
            "model": "deepseek-v4-pro", "messages": [{"role": "user", "content": "Synthetic"}],
        })
        self.assertEqual(status, 400)
        (self.root / "ledger.json").unlink()
        status, _ = self.request("/budget")
        self.assertEqual(status, 503)
        status, _ = self.request("/v1/chat/completions", {
            "model": "deepseek-flash", "messages": [{"role": "user", "content": "Synthetic"}],
        })
        self.assertEqual(status, 503)

    def test_success_caps_output_and_settles_at_uncached_peak_price(self):
        received = []

        class Provider(self.gateway.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                body = json.dumps({"choices": [], "usage": {
                    "prompt_tokens": 1000, "completion_tokens": 100,
                }}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        provider = self.gateway.ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        thread = threading.Thread(target=provider.serve_forever, daemon=True)
        thread.start()
        self.gateway.UPSTREAM = f"http://127.0.0.1:{provider.server_port}/v1/chat/completions"
        self.ledger["calls"] = []
        (self.root / "ledger.json").write_text(json.dumps(self.ledger))
        try:
            status, _ = self.request("/v1/chat/completions", {
                "model": "deepseek-flash", "messages": [{"role": "user", "content": "Synthetic"}],
                "max_tokens": 99999, "stream": True,
            })
            self.assertEqual(status, 200)
            self.assertEqual(received[0]["max_tokens"], 8192)
            self.assertFalse(received[0]["stream"])
            self.assertEqual(received[0]["thinking"], {"type": "disabled"})
            _, budget = self.request("/budget")
            self.assertEqual(budget["committed_upper_bound_cny"], 0.0028)
            self.assertEqual(budget["unknown_calls"], 0)
        finally:
            provider.shutdown()
            provider.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
