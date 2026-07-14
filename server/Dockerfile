FROM node:20@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node . .

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app

USER node

EXPOSE 3031

CMD ["npm", "start"]
