# Secrets

Encrypted values such as API tokens and passwords.

- Keys match `[A-Z][A-Z0-9_]*`, for example `API_TOKEN`.
- `secret_list` returns key names and descriptions only. Values are never returned to agents.
- Code reads a secret with `await agenthands.secrets.get("API_TOKEN")` and must never log it or return it. See [runtime.md](runtime.md).
- Secret values should not pass through chat. Write the code, then tell the user which keys it needs and ask them to add the values in the web UI (Secrets page). Check with `secret_list` that the key exists before you run the tool.
- Use `secret_set` only when the user has explicitly given you the value for this purpose.
- Missing secret at run time: `secrets.get` returns null unless you pass a default. Check for it and throw a clear error such as "Add the API_TOKEN secret".
