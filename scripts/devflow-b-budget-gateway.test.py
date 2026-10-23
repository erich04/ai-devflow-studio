"""Offline tests only. Upstream is replaced by a loopback fixture."""
import importlib.util
import json
import multiprocessing
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('b_gateway', Path(__file__).with_name('devflow-b-budget-gateway.py'))
gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)

def reserve_worker(root, queue):
    try: queue.put(gateway.Ledger(root).reserve(2_000_000))
    except gateway.BudgetError: queue.put(None)

class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.ledger = gateway.Ledger(self.root); self.ledger.initialize()
    def tearDown(self): self.temp.cleanup()
    def test_cross_process_atomic_budget(self):
        context = multiprocessing.get_context('fork'); queue = context.Queue()
        workers = [context.Process(target=reserve_worker, args=(self.root, queue)) for _ in range(8)]
        for worker in workers: worker.start()
        results = [queue.get(timeout=10) for _ in workers]
        for worker in workers: worker.join(10); self.assertEqual(worker.exitcode, 0)
        self.assertEqual(len([r for r in results if r]), 4)
        self.assertEqual(self.ledger.summary()['committed_and_reserved_cny'], 8)
    def test_restart_unknown_and_close_never_reset(self):
        self.ledger.reserve(4_000_000)
        resumed = gateway.Ledger(self.root)
        self.assertEqual(resumed.summary()['remaining_cny'], 4)
        with self.assertRaises(FileExistsError): resumed.initialize()
        resumed.change(lambda data: data.update(closed=True))
        with self.assertRaises(gateway.BudgetError): resumed.reserve(1)
        self.assertEqual(resumed.summary()['unknown_calls'], 1)
    def test_settlement_releases_only_known_spend_and_blocks_underquote(self):
        ident = self.ledger.reserve(1000)
        self.ledger.finish(ident, 'completed', {'prompt_tokens': 10, 'completion_tokens': 10})
        self.assertEqual(self.ledger.summary()['committed_and_reserved_cny'], 0.0001)
        ident = self.ledger.reserve(1)
        self.ledger.finish(ident, 'completed', {'prompt_tokens': 1, 'completion_tokens': 1})
        self.assertTrue(self.ledger.summary()['blocked'])
        with self.assertRaises(gateway.BudgetError): self.ledger.reserve(10)
    def test_missing_corrupt_and_invalid_identity_fail_closed(self):
        source = self.root / 'ledger.json'; original = source.read_text()
        source.unlink()
        with self.assertRaises(FileNotFoundError): self.ledger.reserve(10)
        source.write_text('broken')
        with self.assertRaises(json.JSONDecodeError): self.ledger.reserve(10)
        data = json.loads(original); data['budget_microyuan'] += 1; source.write_text(json.dumps(data))
        with self.assertRaises(gateway.BudgetError): self.ledger.reserve(10)
    def test_stream_reasoning_tools_preserved(self):
        data = {'model': gateway.MODEL, 'messages': [{'role': 'user', 'content': 'test'}],
                'stream': True, 'thinking': {'type': 'enabled'}, 'max_tokens': 4096,
                'tools': [{'type': 'function', 'function': {'name': 'question'}}]}
        payload, stream, bound = gateway.prepare(data); parsed = json.loads(payload)
        self.assertTrue(stream); self.assertEqual(parsed['thinking'], data['thinking'])
        self.assertEqual(parsed['tools'], data['tools']); self.assertTrue(parsed['stream_options']['include_usage'])
        self.assertGreater(bound, 4096 * 8)
        payload, _, bound = gateway.prepare({**data, 'max_tokens': 65536})
        self.assertEqual(json.loads(payload)['max_tokens'], 65536)
        self.assertGreaterEqual(bound, 65536 * 8)
        with self.assertRaises(gateway.RequestError): gateway.prepare({**data, 'max_tokens': 65537})

class TransportTests(unittest.TestCase):
    def test_actual_stream_and_unknown_stream_settlement(self):
        with tempfile.TemporaryDirectory() as root:
            ledger = gateway.Ledger(root); ledger.initialize()
            key = Path(root) / 'synthetic-key'; key.write_text('sk-synthetic-local-only')
            received = []; complete = [True]
            class Upstream(BaseHTTPRequestHandler):
                def log_message(self, *_): pass
                def do_POST(self):
                    received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                    self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
                    self.wfile.write(b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n')
                    self.wfile.write(b'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n')
                    if complete[0]: self.wfile.write(b'data: [DONE]\n\n')
            upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
            proxy = ThreadingHTTPServer(('127.0.0.1', 0), gateway.make_handler(ledger, key))
            old = gateway.UPSTREAM; gateway.UPSTREAM = f'http://127.0.0.1:{upstream.server_port}/fixture'
            threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (upstream, proxy)]
            for thread in threads: thread.start()
            try:
                def call():
                    request = urllib.request.Request(f'http://127.0.0.1:{proxy.server_port}/v1/chat/completions',
                        data=json.dumps({'model': gateway.MODEL, 'messages': [{'role': 'user', 'content': 'fixture'}],
                                         'stream': True, 'max_tokens': 1000, 'thinking': {'type': 'enabled'}}).encode(),
                        headers={'Content-Type': 'application/json'})
                    try:
                        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request) as response: return response.read()
                    except Exception as error:
                        raise AssertionError(ledger.change()) from error
                self.assertIn(b'[DONE]', call())
                self.assertEqual(ledger.summary()['unknown_calls'], 0)
                self.assertTrue(received[0]['stream']); self.assertEqual(received[0]['thinking']['type'], 'enabled')
                complete[0] = False; self.assertNotIn(b'[DONE]', call())
                self.assertEqual(ledger.summary()['unknown_calls'], 1)
                self.assertGreater(ledger.summary()['committed_and_reserved_cny'], 0.0006)
            finally:
                gateway.UPSTREAM = old
                for server in (proxy, upstream): server.shutdown(); server.server_close()
                for thread in threads: thread.join()

if __name__ == '__main__': unittest.main()
