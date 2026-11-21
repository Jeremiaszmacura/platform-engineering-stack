# KV v2 keeps values under data/. The documentation service keeps the signed-in person's GitHub token here.
path "services/data/documentation/*" {
  capabilities = ["create", "read", "update"]
}
