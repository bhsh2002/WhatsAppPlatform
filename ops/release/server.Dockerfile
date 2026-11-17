# Candidate build only. Keep the reviewed Node base; compile native SQLite
# from the npm-integrity-pinned source with the base image's Node headers.
FROM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm_config_build_from_source=true npm_config_nodedir=/usr/local npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app
USER node
EXPOSE 3031
CMD ["npm", "start"]
