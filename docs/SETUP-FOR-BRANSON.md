# Setup for Branson

This server lets Grok, ChatGPT, Claude, and other MCP clients read and edit your Workflowy outline. It runs on Vercel. Search keeps a copy of the outline text in a Neon Postgres database that you own.

Do the Vercel project yourself in the Vercel dashboard, by importing this GitHub repo. Do not upload it with the Vercel CLI. Do not put secret values in git, in this file, or in chat.

## Keys you need

Create these four values. Nothing else is required.

| What | Where you get it | Where it goes | What it is |
| --- | --- | --- | --- |
| `WORKFLOWY_API_KEY` | [Workflowy API reference](https://beta.workflowy.com/api-reference/) | Vercel environment variable only | Lets the server read and edit your outline. Never put this in an MCP client. |
| `DATABASE_URL` | Neon, pooled connection string | Vercel environment variable only | Your Postgres database. Holds bookmarks, search cache, settings, and diagnostic logs. |
| `ADMIN_SECRET` | `openssl rand -hex 32` | Vercel environment variable only | Password for the web console at the site root. At least 32 characters. |
| `MCP_ACCESS_SECRET` | a second `openssl rand -hex 32` | Vercel environment variable, and the MCP client's `Authorization` header | Password for `/api/mcp`. At least 32 characters. This is the only secret an AI client should have. |

Generate the two secrets on your own machine:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Use one output for `ADMIN_SECRET` and the other for `MCP_ACCESS_SECRET`. They must be different.

Optional, not a secret:

| Name | When to set it |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated browser origins, such as `https://claude.ai,https://chatgpt.com`, if you want to refuse other websites. Leave it unset until a browser client fails without it. Desktop and server clients do not need it. |
| `NEXT_TELEMETRY_DISABLED` | Set to `1`. The repo's build command already sets this. |

## Neon

1. Create a Neon account and a project.
2. Create a database. The default database is fine.
3. Copy the **pooled** connection string. The host name contains `-pooler`. It looks like `postgresql://USER:PASSWORD@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require`.
4. That whole string is `DATABASE_URL`.
5. The app creates its tables the first time it runs. You do not run a migration by hand.

Neon stores node names, notes, bookmarks, and short diagnostic logs. It does not store the Workflowy API key. It stores a SHA-256 hash of that key so rows can be separated.

Neon and Vercel both have free tiers that cover a personal outline. Vercel Hobby is $0 and includes the function time a personal server uses. If a full sync of a very large outline hits the hobby timeout, Vercel Pro is $20 per month. Neon storage for text outlines stays inside the free allowance unless the outline is unusually large.

## Vercel project settings

Create the project from the Vercel dashboard: **Add New → Project → Import Git Repository → `bransonatx/workflowy-mcp`**. Leave the production branch as `main`, and import it after the security fixes are on `main`.

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | Repository root. Leave the root directory field empty. |
| Node.js version | 22.x |
| Install command | `npm ci` |
| Build command | `NEXT_TELEMETRY_DISABLED=1 next build` |
| Output directory | Default. Do not set a custom output directory. |
| Environment variables | `DATABASE_URL`, `ADMIN_SECRET`, `MCP_ACCESS_SECRET`, `WORKFLOWY_API_KEY` |

Apply the environment variables to Production. Add them to Preview as well if you open preview deployments. Redeploy after saving them.

`vercel.json` in the repo already sets the install command and the build command. If the dashboard shows different commands, change the dashboard to the values above.

Leave Fluid Compute off until a sync times out. The MCP route asks for up to 60 seconds, which is the Hobby limit.

## After the first deploy

1. Open `https://YOUR-PROJECT.vercel.app/`.
2. Unlock it with `ADMIN_SECRET`.
3. Confirm the page says the server is connected.
4. Point each AI client at Streamable HTTP, not stdio.

Endpoint:

```text
https://YOUR-PROJECT.vercel.app/api/mcp
```

Header:

```text
Authorization: Bearer YOUR_MCP_ACCESS_SECRET
```

The client configuration must not include `WORKFLOWY_API_KEY`.

## What stays private

- `WORKFLOWY_API_KEY`, `DATABASE_URL`, `ADMIN_SECRET`, and `MCP_ACCESS_SECRET` live in Vercel only.
- The Workflowy key is sent only to `workflowy.com` and `beta.workflowy.com`.
- Outline text is sent to those Workflowy hosts, to your Neon database, and back to the MCP client that called the tool.
- Diagnostic logs store tool names, node ids, and timing. They are scrubbed for connection strings and bearer tokens.
- The app does not send the outline to an analytics service. Next.js telemetry is turned off for the build.
