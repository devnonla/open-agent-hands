# Workspaces

A workspace isolates tools, tool folders, hosted MCP servers, KV, secrets, datatables, sites, jobs and API keys. The `default` workspace always exists and cannot be deleted.

- `list_workspaces` first when unsure. Every other tool takes an optional `workspace` (id or name), default `default`.
- Names are unique per workspace. Site slugs are global, because public URLs carry no workspace.
- Tool, job and site code only sees its own workspace's kv, secrets and datatables. Moving work to another workspace means recreating it there.
- `create_workspace(name, description?)` (name up to 80 characters), `update_workspace(workspace_id, name?, description?)`.
- `delete_workspace(workspace_id, confirm=true)` removes everything in it and cannot be undone. Ask the user first and say what it contains.
- When a resource "is not found", check that you are in the right workspace before concluding it is missing.
- Users and settings are global, not per workspace.
