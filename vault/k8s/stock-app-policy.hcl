# What stock-app's Vault token may do: read and write its own keys in the services/ KV v2 mount, nothing else.
# KV v2 keeps the values under data/, so services/stock-app/<key> is services/data/stock-app/<key> here.
path "services/data/stock-app/*" {
  capabilities = ["create", "read", "update"]
}
