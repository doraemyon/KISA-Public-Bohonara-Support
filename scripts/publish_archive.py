#!/usr/bin/env python3
"""Publish complete bilingual documents from this repository to Cloudflare D1."""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import process_notice

FILES = {
    "koHtml": "ko/index.html",
    "enHtml": "en/index.html",
    "koText": "ko/notice.txt",
    "enText": "en/notice.txt",
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url: str, token: str, body: bytes | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers)
    for attempt in range(3):
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 429 and not 500 <= error.code <= 599:
                raise
            if attempt == 2:
                raise
        except (OSError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)
    raise RuntimeError("Archive request failed.")


def package(payload: dict) -> tuple[str, bytes]:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    digest = sha256(encoded).hexdigest()
    payload["digest"] = digest
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(body) > 1_800_000:
        raise RuntimeError(f"Archive {payload.get('id', 'index')} exceeds the publication limit.")
    return digest, body


def document(path: Path) -> tuple[str, bytes]:
    meta = json.loads((path / "metadata.json").read_text(encoding="utf-8"))
    if meta.get("notice_id") != path.name or meta.get("translation_status", "complete") != "complete":
        raise RuntimeError(f"Notice {path.name} does not have a complete bilingual record.")
    files = {name: (path / relative).read_text(encoding="utf-8") for name, relative in FILES.items()}
    if not all(text.strip() for text in files.values()):
        raise RuntimeError(f"Notice {path.name} contains an empty page or download.")
    return package({"kind": "document", "id": path.name, **files})


def main() -> None:
    origin = urllib.parse.urlsplit(process_notice.required_env("PUBLIC_BASE_URL"))
    if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path not in ("", "/") or origin.query or origin.fragment:
        raise RuntimeError("PUBLIC_BASE_URL must be the HTTPS origin of the Worker.")
    url = urllib.parse.urlunsplit((origin.scheme, origin.netloc, "/internal/notice-publication", "", ""))
    oidc_url = process_notice.required_env("ACTIONS_ID_TOKEN_REQUEST_URL")
    separator = "&" if "?" in oidc_url else "?"
    jwt = request_json(
        oidc_url + separator + urllib.parse.urlencode({"audience": url}),
        process_notice.required_env("ACTIONS_ID_TOKEN_REQUEST_TOKEN"),
    )["value"]
    manifest = request_json(url, jwt)
    site = process_notice.SITE_ROOT
    pending: list[bytes] = []
    total = 0
    for path in sorted((site / "notices").iterdir()):
        if not path.is_dir() or not re.fullmatch(r"[0-9]{1,20}", path.name):
            continue
        digest, body = document(path)
        total += 1
        if manifest["documents"].get(path.name) != digest:
            pending.append(body)
    if not total:
        raise RuntimeError("There are no complete notices to publish.")

    # Never advance the public index until every listed document has been stored.
    with ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(lambda body: request_json(url, jwt, body), pending):
            if result.get("ok") is not True:
                raise RuntimeError("Worker did not acknowledge the document.")
    digest, body = package({"kind": "index", "html": (site / "index.html").read_text(encoding="utf-8")})
    if manifest["index"] != digest and request_json(url, jwt, body).get("ok") is not True:
        raise RuntimeError("Worker did not acknowledge the index.")
    print(f"Published {len(pending)} changed bilingual notices; {total} ready in D1.")


if __name__ == "__main__":
    main()
