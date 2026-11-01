# Used by Glama automated safety/quality checks. No secrets: supply KNOWFIRM_API_KEY at run time.
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY index.mjs tools.mjs manifest.json LICENSE README.md ./
USER node
ENTRYPOINT ["node", "index.mjs"]
