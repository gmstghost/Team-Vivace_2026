"""로컬 개발 서버.

    python serve.py          # http://localhost:8000
    python serve.py 5000     # 포트 지정

`python -m http.server`와 같지만 두 가지를 고정합니다.
  1. .js 파일을 text/javascript로 보냄 — Windows에서는 레지스트리 설정에 따라
     text/plain으로 나가서 ES 모듈이 로드되지 않는 경우가 있습니다.
  2. 캐시를 끔 — 코드를 고친 뒤 새로고침하면 바로 반영됩니다.

Web Serial(아두이노 연결)은 HTTPS 또는 localhost에서만 동작하므로
반드시 http://localhost 주소로 여세요 (127.0.0.1이나 PC IP 주소 X).
"""

import http.server
import sys
from functools import partial
from pathlib import Path

PUBLIC_DIR = Path(__file__).resolve().parent / "public"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".ino": "text/plain; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(Handler, directory=str(PUBLIC_DIR))
    with http.server.ThreadingHTTPServer(("localhost", port), handler) as httpd:
        print(f"SAFE Route → http://localhost:{port}  (Ctrl+C로 종료)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
