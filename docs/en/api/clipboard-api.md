# Host Clipboard API

`GET /api/clipboard` returns text from the clipboard of the machine running Dinotty. The mobile quick keyboard uses this endpoint for host-clipboard paste.

## Authentication

This is a sensitive route. A server token must be configured, and every request must carry either a valid Dinotty session cookie or the configured token as `Authorization: Bearer <token>`. IP-whitelist access alone is not sufficient. Cookie requests also require same-origin browser proof; Bearer requests do not.

## Response

Successful responses are JSON and are never cacheable:

```http
Cache-Control: no-store
Content-Type: application/json

{"text":"clipboard text"}
```

An empty text clipboard returns `{"text":""}`. Clipboard text is limited to 256 KiB. Generic error responses use `401`, `403`, `413`, or `503` and also include `Cache-Control: no-store`. Clipboard contents are not logged.
