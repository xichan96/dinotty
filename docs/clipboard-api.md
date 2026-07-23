# Host Clipboard API / 主机剪贴板 API

`GET /api/clipboard` returns text from the clipboard of the machine running Dinotty. The mobile quick keyboard uses this endpoint for host-clipboard paste.

`GET /api/clipboard` 返回运行 Dinotty 的主机剪贴板文本，移动端快捷键盘的主机粘贴功能使用此接口。

## Authentication / 认证

This is a sensitive route. A server token must be configured, and every request must carry either a valid Dinotty session cookie or the configured token as `Authorization: Bearer <token>`. IP-whitelist access alone is not sufficient. Cookie requests also require same-origin browser proof; Bearer requests do not.

这是敏感接口。服务端必须已配置令牌，每次请求都必须携带有效的 Dinotty 会话 Cookie，或通过 `Authorization: Bearer <token>` 携带已配置令牌。仅 IP 白名单访问无效。Cookie 请求还必须提供浏览器同源证明；Bearer 请求不受此限制。

## Response / 响应

Successful responses are JSON and are never cacheable:

```http
Cache-Control: no-store
Content-Type: application/json

{"text":"clipboard text"}
```

An empty text clipboard returns `{"text":""}`. Clipboard text is limited to 256 KiB. Generic error responses use `401`, `403`, `413`, or `503` and also include `Cache-Control: no-store`. Clipboard contents are not logged.

文本剪贴板为空时返回 `{"text":""}`。剪贴板文本上限为 256 KiB。通用错误响应使用 `401`、`403`、`413` 或 `503`，并同样包含 `Cache-Control: no-store`。剪贴板内容不会写入日志。
