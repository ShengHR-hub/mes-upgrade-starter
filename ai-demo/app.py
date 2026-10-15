#!/usr/bin/env python3
"""MES-AI 演示服务（纯标准库）。
运行: python3 app.py [端口，默认 8080]
打开: http://localhost:8080
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

import daily_report
import rag

BASE_DIR = __import__("os").path.dirname(__import__("os").path.abspath(__file__))


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/report":
            r = daily_report.render(daily_report.gen_demo_day())
            return self._json({"markdown": r["markdown"], "mode": r["mode"]})
        if path == "/api/health":
            return self._json({"ok": True})
        # 静态页
        fpath = BASE_DIR + "/static/index.html" if path in ("/", "/index.html") else None
        if fpath:
            body = open(fpath, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/ask":
            n = int(self.headers.get("Content-Length", 0))
            q = json.loads(self.rfile.read(n).decode("utf-8")).get("question", "")
            return self._json(rag.ask(q))
        self.send_response(404)
        self.end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    srv = HTTPServer(("127.0.0.1", port), Handler)
    print(f"MES-AI 演示服务已启动: http://127.0.0.1:{port}")
    print("按 Ctrl+C 停止")
    srv.serve_forever()
