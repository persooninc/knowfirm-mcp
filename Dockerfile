# Used by Glama automated safety/quality checks. No secrets: supply KNOWFIRM_API_KEY at run time.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.mjs tools.mjs manifest.json LICENSE README.md ./
# Run as the image's unprivileged node user by numeric id (uid/gid 1000 in node:20-slim).
USER 1000:1000
# stdio MCP server: no port or long-running daemon to probe, so health checks are explicitly disabled.
HEALTHCHECK NONE
ENTRYPOINT ["node", "index.mjs"]
