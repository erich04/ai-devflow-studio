"""B-package acceptance gateway: CNY 8 cumulative cap; no production credential logs.

Only --initialize creates a NEW ledger. Existing, unknown, and closed records survive
restarts. All consumers share this process/ledger; flock also protects multiple workers.
Official conservative DeepSeek flash prices: input 2 / output 8 CNY per million tokens.
The gateway preserves native tool calls, reasoning and streaming; stream usage is enabled.
"""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import ssl
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CAP = 8_000_000
MAX_REQUEST_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_OUTPUT = 65_536
MODEL = 'deepseek-flash'
UPSTREAM = 'https://api.deepseek.com/v1/chat/completions'
CALL_LOCK = threading.Lock()

class BudgetError(Exception):
    pass

class RequestError(ValueError):
    """A fixed, payload-free request policy explanation safe to expose."""
    pass

def integer(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0

class Ledger:
    def __init__(self, root):
        self.root = Path(root)
    def initialize(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (self.root / 'ledger.json').open('x') as out:
            os.chmod(out.name, 0o600)
            json.dump({'version': 1, 'scope': 'devflow-b-20261023', 'budget_microyuan': CAP,
                       'closed': False, 'blocked': False, 'calls': []}, out)
            out.flush(); os.fsync(out.fileno())
    def change(self, update=None):
        with (self.root / 'ledger.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            source = self.root / 'ledger.json'
            data = json.loads(source.read_text())
            if (data.get('version') != 1 or data.get('scope') != 'devflow-b-20261023'
                or data.get('budget_microyuan') != CAP or not isinstance(data.get('closed'), bool)
                or not isinstance(data.get('blocked'), bool) or not isinstance(data.get('calls'), list)):
                raise BudgetError('B ledger identity or authorization is invalid')
            seen = set()
            for row in data['calls']:
                if (not integer(row.get('id')) or row['id'] in seen or row['id'] < 1
                    or not integer(row.get('reserved_microyuan')) or row['reserved_microyuan'] < 1
                    or ('committed_microyuan' in row and not integer(row['committed_microyuan']))):
                    raise BudgetError('B ledger record is invalid')
                seen.add(row['id'])
            if update:
                update(data)
                temporary = self.root / 'ledger.json.tmp'
                fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
                with os.fdopen(fd, 'w') as out:
                    json.dump(data, out, indent=2); out.write('\n'); out.flush(); os.fsync(out.fileno())
                os.replace(temporary, source)
                directory = os.open(self.root, os.O_RDONLY)
                try: os.fsync(directory)
                finally: os.close(directory)
            return data
    def reserve(self, bound, phase='unspecified'):
        if not integer(bound) or not 0 < bound <= CAP:
            raise BudgetError('Invalid request bound')
        result = None
        def update(data):
            nonlocal result
            if data['closed'] or data['blocked']:
                raise BudgetError('B authorization is closed or blocked')
            spent = sum(r.get('committed_microyuan', r['reserved_microyuan']) for r in data['calls'])
            if spent + bound > CAP:
                raise BudgetError('B cumulative CNY 8 limit reached')
            result = max((r['id'] for r in data['calls']), default=0) + 1
            data['calls'].append({'id': result, 'phase': phase[:80], 'started_at': time.time(),
                                 'reserved_microyuan': bound, 'status': 'unknown'})
        self.change(update)
        return result
    def finish(self, call_id, status, usage=None):
        def update(data):
            row = next(r for r in data['calls'] if r['id'] == call_id)
            if row['status'] != 'unknown':
                raise BudgetError('A terminal settlement cannot be overwritten')
            row.update(status=status, finished_at=time.time())
            if usage and integer(usage.get('prompt_tokens')) and integer(usage.get('completion_tokens')):
                row['usage'] = {k: v for k, v in usage.items() if k in (
                    'prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens') and integer(v)}
                cost = usage['prompt_tokens'] * 2 + usage['completion_tokens'] * 8
                row['committed_microyuan'] = cost
                if cost > row['reserved_microyuan']:
                    data['blocked'] = True
        return self.change(update)
    def summary(self):
        data = self.change()
        amount = sum(r.get('committed_microyuan', r['reserved_microyuan']) for r in data['calls'])
        return {'scope': data['scope'], 'cap_cny': CAP / 1e6, 'closed': data['closed'],
                'blocked': data['blocked'], 'calls': len(data['calls']),
                'committed_and_reserved_cny': amount / 1e6, 'remaining_cny': (CAP - amount) / 1e6,
                'unknown_calls': sum('committed_microyuan' not in r for r in data['calls'])}

def prepare(data):
    if not isinstance(data, dict) or data.get('model') != MODEL:
        raise RequestError('Only the authorized model is available')
    if not isinstance(data.get('messages'), list) or not 1 <= len(data['messages']) <= 256:
        raise RequestError('Expected bounded messages')
    if not isinstance(data.get('tools', []), list) or len(data.get('tools', [])) > 64:
        raise RequestError('Too many tools')
    for message in data['messages']:
        if not isinstance(message, dict): raise RequestError('Invalid message')
        content = message.get('content')
        if content is not None and not isinstance(content, str):
            if not isinstance(content, list) or any(not isinstance(part, dict) or part.get('type') != 'text' or not isinstance(part.get('text'), str) for part in content):
                raise RequestError('Only text content is authorized')
        if any(key in message for key in ('audio', 'video', 'images')):
            raise RequestError('Only text content is authorized')
    if any(not isinstance(tool, dict) or tool.get('type') != 'function' for tool in data.get('tools', [])):
        raise RequestError('Only client function tools are authorized')
    if data.get('n', 1) != 1 or not isinstance(data.get('stream', False), bool):
        raise RequestError('Only one completion is permitted')
    data = dict(data)
    output = data.get('max_tokens', data.get('max_completion_tokens', 8192))
    if not integer(output) or not 1 <= output <= MAX_OUTPUT:
        raise RequestError('Explicit output exceeds B verification bounds')
    data.pop('max_completion_tokens', None)
    data['max_tokens'] = output
    if data.get('stream'):
        data['stream_options'] = {**data.get('stream_options', {}), 'include_usage': True}
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
    if len(payload) > MAX_REQUEST_BYTES:
        raise RequestError('Request exceeds 512 KiB')
    # UTF-8 bytes overestimate text tokens; framing safety margin is also reserved.
    bound = (len(payload) + 8192) * 2 + output * 8 + 1000
    return payload, data.get('stream', False), bound

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None

def make_handler(ledger, key_file):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.0'
        def log_message(self, *_): pass
        def reply(self, status, data):
            body = json.dumps(data).encode()
            self.send_response(status); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_GET(self):
            if self.path not in ('/health', '/budget'): return self.reply(404, {'error': 'Unknown path'})
            try: self.reply(200, ledger.summary())
            except Exception: self.reply(503, {'error': 'B ledger unavailable'})
        def do_POST(self):
            if self.path not in ('/v1/chat/completions', '/chat/completions'):
                return self.reply(404, {'error': 'Unknown path'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= MAX_REQUEST_BYTES or self.headers.get('Transfer-Encoding'):
                    raise ValueError('Invalid request length')
                payload, streaming, bound = prepare(json.loads(self.rfile.read(size)))
            except Exception as error:
                reason = str(error) if isinstance(error, RequestError) else 'Malformed or unbounded request'
                print(json.dumps({'event': 'request_rejected', 'reason': reason, 'provider_called': False}), flush=True)
                return self.reply(400, {'error': {'message': 'B bounded request rejected: ' + reason, 'code': 'b_request_policy'}})
            with CALL_LOCK:
                try:
                    key = Path(key_file).read_text().strip()
                    if not key.startswith('sk-'): raise ValueError('Credential unavailable')
                    call_id = ledger.reserve(bound, self.headers.get('X-Devflow-Validation-Phase', 'unspecified'))
                except BudgetError as error: return self.reply(402, {'error': {'message': str(error)}})
                except Exception: return self.reply(503, {'error': {'message': 'Credential or ledger unavailable'}})
                headers_sent = False
                try:
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
                    request = urllib.request.Request(UPSTREAM, data=payload,
                        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
                    usage = None
                    with opener.open(request, timeout=180) as response:
                        if streaming:
                            self.send_response(200); self.send_header('Content-Type', 'text/event-stream')
                            self.send_header('Cache-Control', 'no-cache'); self.end_headers(); headers_sent = True
                            count = 0; done = False
                            while True:
                                line = response.readline(1024 * 1024)
                                if not line: break
                                count += len(line)
                                if count > MAX_RESPONSE_BYTES: raise ValueError('Response too large')
                                if line.startswith(b'data:'):
                                    item = line[5:].strip()
                                    if item == b'[DONE]': done = True
                                    else:
                                        event = json.loads(item)
                                        if isinstance(event.get('usage'), dict): usage = event['usage']
                                self.wfile.write(line); self.wfile.flush()
                            if not done: raise ValueError('Incomplete upstream stream')
                        else:
                            body = response.read(MAX_RESPONSE_BYTES + 1)
                            if len(body) > MAX_RESPONSE_BYTES: raise ValueError('Response too large')
                            result = json.loads(body); usage = result.get('usage')
                    ledger.finish(call_id, 'completed', usage)
                    if not streaming: self.reply(200, result)
                except Exception as error:
                    # Retain full reservation, including stream cancellation and missing usage.
                    try: ledger.finish(call_id, 'unknown_' + type(error).__name__)
                    except Exception: pass
                    if not headers_sent:
                        try: self.reply(502, {'error': {'message': 'Upstream failed; B reservation retained'}})
                        except Exception: pass
    return Handler

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    parser.add_argument('--key-file', default=os.environ.get('DEEPSEEK_KEY_FILE'))
    parser.add_argument('--port', type=int, default=0)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--initialize', action='store_true'); group.add_argument('--close', action='store_true')
    group.add_argument('--summary', action='store_true')
    args = parser.parse_args(); ledger = Ledger(args.state)
    if args.initialize:
        if os.environ.get('DEVFLOW_B_LIVE_AUTHORIZED') != '1': raise SystemExit('Explicit B authorization required')
        ledger.initialize()
    elif args.close: ledger.change(lambda data: data.update(closed=True))
    elif args.summary: pass
    else:
        if os.environ.get('DEVFLOW_B_LIVE_AUTHORIZED') != '1' or not args.key_file:
            raise SystemExit('Explicit B authorization and existing key file are required')
        ledger.summary()
        server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(ledger, args.key_file))
        print(json.dumps({'url': f'http://127.0.0.1:{server.server_port}', **ledger.summary()}), flush=True)
        server.serve_forever(); return
    print(json.dumps(ledger.summary()))

if __name__ == '__main__': main()
