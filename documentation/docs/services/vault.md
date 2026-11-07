# Vault

HashiCorp Vault in **dev mode** (namespace `vault`) at http://vault.localhost, token `root`. Data is in memory
and lost on restart — playground only.

The `vault-configure` Job creates two KV v2 mounts: `services/` (one path per service, e.g.
`services/stock-app/<key>`, ready for per-service policies) and `infra/` (reserved).
The token comes from the `vault-dev-token` Secret.

```sh
curl -X POST http://stock.localhost/secret -H 'Content-Type: application/json' -d '{"key":"demo","value":"x"}'
curl http://stock.localhost/secret/demo    # 200
```
