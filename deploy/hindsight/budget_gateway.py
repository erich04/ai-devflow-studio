"""Test-only DeepSeek gateway for DevFlow synthetic Hindsight validation.

Adapted from the locally reviewed DSH gateway; uses a separate ledger capped at CNY 5.
Prices verified 2026-10-20: https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"""
import fcntl
import json
import math
import os
from pathlib import Path
import re
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(os.environ.get("GATEWAY_STATE_DIR", "/state"))
KEY_FILE = Path(os.environ.get("DEEPSEEK_KEY_FILE", "/run/secrets/deepseek_api_key"))
MAX_BYTES = 131072
MAX_OUTPUT = 8192
RESERVATION_MICROYUAN = 350000
MAX_BUDGET_MICROYUAN = 5000000
MODEL = "deepseek-flash"
UPSTREAM = "https://api.deepseek.com/v1/chat/completions"
CALL_LOCK = threading.Lock()


class BudgetError(Exception):
    pass


def parse_budget_microyuan(raw):
    if not isinstance(raw, str) or re.fullmatch(r"[1-9][0-9]{0,6}", raw) is None:
        raise BudgetError("Budget must be a positive integer number of microyuan.")
    value = int(raw)
    if value > MAX_BUDGET_MICROYUAN:
        raise BudgetError("Budget cannot exceed the cumulative CNY 5 authorization.")
    return value


BUDGET_MICROYUAN = parse_budget_microyuan(
    os.environ.get("DEVFLOW_HINDSIGHT_TEST_BUDGET_MICROYUAN", "5000000"))


def change_ledger(update=None):
    # A missing/corrupt ledger fails closed. Never reset a budget on restart.
    with (ROOT / "ledger.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = ROOT / "ledger.json"
        ledger = json.loads(path.read_text())
        if ledger["budget_microyuan"] != BUDGET_MICROYUAN:
            raise BudgetError("Budget configuration differs from the immutable ledger cap.")
        if not isinstance(ledger.get("closed"), bool):
            raise BudgetError("Authorization state is missing.")
        if update is not None:
            update(ledger)
            tmp = ROOT / "ledger.json.tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as out:
                json.dump(ledger, out, ensure_ascii=False, indent=2)
                out.write("\n")
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, path)
            directory_fd = os.open(ROOT, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        return ledger


def reserve(upper_bound=RESERVATION_MICROYUAN):
    call_id = None
    if not 0 < upper_bound <= RESERVATION_MICROYUAN:
        raise BudgetError("Invalid request reservation.")

    def update(ledger):
        nonlocal call_id
        if ledger["closed"]:
            raise BudgetError("CNY 5 synthetic test authorization is closed.")
        reserved = sum(c.get("committed_microyuan", c["reserved_microyuan"])
                       for c in ledger["calls"])
        if ledger.get("blocked"):
            raise BudgetError("Provider usage exceeded its reservation; review required.")
        if reserved + upper_bound > BUDGET_MICROYUAN:
            raise BudgetError("CNY 5 authorization exhausted; further LLM calls blocked.")
        call_id = len(ledger["calls"]) + 1
        ledger["calls"].append({
            "id": call_id,
            "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "reserved_microyuan": upper_bound,
            "status": "reserved_unknown",
        })

    change_ledger(update)
    return call_id


def finish(call_id, status, usage=None, error_type=None):
    def update(ledger):
        entry = next(c for c in ledger["calls"] if c["id"] == call_id)
        entry["status"] = status
        if error_type:
            entry["error_type"] = error_type
        if usage:
            fields = ("prompt_tokens", "completion_tokens", "prompt_cache_hit_tokens",
                      "prompt_cache_miss_tokens")
            safe = {k: v for k, v in usage.items()
                    if k in fields and isinstance(v, int) and not isinstance(v, bool) and v >= 0}
            entry["usage"] = safe
            if "prompt_tokens" in safe and "completion_tokens" in safe:
                prompt = safe["prompt_tokens"]
                hit = min(safe.get("prompt_cache_hit_tokens", 0), prompt)
                # Official peak prices, CNY per million: hit .04, miss 2, output 8.
                entry["estimated_peak_microyuan"] = math.ceil(
                    hit * 0.04 + (prompt - hit) * 2 + safe["completion_tokens"] * 8)
                # Settle at uncached peak prices: still an upper bound, even
                # without trusting a provider's cache discount calculation.
                committed = prompt * 2 + safe["completion_tokens"] * 8
                entry["committed_microyuan"] = committed
                if committed > entry["reserved_microyuan"]:
                    ledger["blocked"] = True
    change_ledger(update)


def prepare(data):
    if not isinstance(data, dict) or data.get("model") != MODEL:
        raise ValueError("Only the authorized deepseek-flash model is allowed.")
    messages = data.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 128:
        raise ValueError("Expected 1–128 text messages.")
    for message in messages:
        if not isinstance(message, dict) or not (
            isinstance(message.get("content"), str) or message.get("content") is None
        ):
            raise ValueError("Only text messages are accepted.")
    if len(data.get("tools", [])) > 64:
        raise ValueError("At most 64 tool definitions are allowed.")
    data = dict(data)
    data.pop("max_completion_tokens", None)
    data.pop("stream_options", None)
    requested = data.get("max_tokens", MAX_OUTPUT)
    if not isinstance(requested, int) or isinstance(requested, bool) or requested < 1:
        raise ValueError("Invalid max_tokens.")
    data.update(max_tokens=min(requested, MAX_OUTPUT), n=1, stream=False,
                thinking={"type": "disabled"})
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    if len(payload) > MAX_BYTES:
        raise ValueError("The bounded gateway accepts at most 128 KiB per request.")
    return payload


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log prompts, tool content, headers, or credentials.

    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path not in ("/health", "/budget"):
            return self.reply(404, {"error": {"message": "Unknown path"}})
        try:
            ledger = change_ledger()
            return self.reply(200, {
                "ok": True, "model": MODEL, "budget_cny": BUDGET_MICROYUAN / 1e6, "closed": ledger["closed"],
                "calls": len(ledger["calls"]),
                "committed_upper_bound_cny": sum(
                    c.get("committed_microyuan", c["reserved_microyuan"])
                    for c in ledger["calls"]) / 1e6,
                "known_peak_estimate_cny": sum(
                    c.get("estimated_peak_microyuan", 0) for c in ledger["calls"]) / 1e6,
                "unknown_calls": sum("estimated_peak_microyuan" not in c for c in ledger["calls"]),
            })
        except Exception:
            return self.reply(503, {"error": {"message": "Budget ledger unavailable"}})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            return self.reply(404, {"error": {"message": "Unknown path"}})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BYTES or self.headers.get("Transfer-Encoding"):
                raise ValueError("Request size is missing or exceeds the limit.")
            payload = prepare(json.loads(self.rfile.read(length)))
        except (ValueError, TypeError):
            return self.reply(400, {"error": {"message": "Request violates the bounded gateway policy"}})
        # Serial forwarding; failed and uncertain calls keep their full reservation.
        with CALL_LOCK:
            try:
                key = KEY_FILE.read_text().strip()
                if not key.startswith("sk-"):
                    raise ValueError("Invalid credential")
                upper_bound = (len(payload) + 8192) * 2 + json.loads(payload)["max_tokens"] * 8 + 1000
                call_id = reserve(upper_bound)
            except BudgetError as exc:
                return self.reply(402, {"error": {"message": str(exc)}})
            except Exception:
                return self.reply(503, {"error": {"message": "Credential or budget unavailable"}})
            request = urllib.request.Request(UPSTREAM, data=payload, headers={
                "Authorization": "Bearer " + key, "Content-Type": "application/json"
            })
            try:
                opener = urllib.request.build_opener(
                    # The only production destination is the fixed DeepSeek HTTPS URL.
                    urllib.request.ProxyHandler({}), NoRedirect(),
                    urllib.request.HTTPSHandler(context=ssl.create_default_context()))
                with opener.open(request, timeout=120) as response:
                    body = response.read(4 * 1024 * 1024)
                    result = json.loads(body)
                finish(call_id, "completed", result.get("usage"))
            except urllib.error.HTTPError as exc:
                finish(call_id, "upstream_http_" + str(exc.code))
                return self.reply(502, {"error": {"message": "DeepSeek returned HTTP " + str(exc.code)}})
            except Exception as exc:
                try:
                    finish(call_id, "unknown", error_type=type(exc).__name__)
                except Exception:
                    pass
                return self.reply(502, {"error": {"message": "Upstream failed; reservation retained"}})
            return self.reply(200, result)


if __name__ == "__main__":
    if sys.argv[1:] == ["--initialize"]:
        if os.environ.get("DEVFLOW_HINDSIGHT_TEST_AUTHORIZED") != "1":
            raise SystemExit("Explicit authorization is required to initialize the CNY 5 test ledger.")
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Exclusive creation: an existing budget is never reset or reopened.
        with (ROOT / "ledger.json").open("x") as out:
            os.chmod(out.name, 0o600)
            json.dump({"budget_microyuan": BUDGET_MICROYUAN, "closed": False,
                       "scope": "DevFlow synthetic Hindsight validation", "calls": []}, out)
            out.flush()
            os.fsync(out.fileno())
        print(f"Initialized a separate CNY {BUDGET_MICROYUAN / 1e6:g} synthetic-test ledger.")
        raise SystemExit(0)
    if sys.argv[1:] == ["--close"]:
        change_ledger(lambda ledger: ledger.update(closed=True))
        print("Synthetic-test authorization closed; further calls are blocked.")
        raise SystemExit(0)
    if sys.argv[1:]:
        raise SystemExit("Supported options: --initialize, --close")
    change_ledger()
    ThreadingHTTPServer(("0.0.0.0", 8787), Handler).serve_forever()
