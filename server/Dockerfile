FROM node:26@sha256:6aa7608b71e5bc3ca0e0cc95e52d7fcbbac54bf84660e0d8d2a59d134d529708

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node . .

RUN mkdir -p /app/data /app/uploads && chown -R node:node /app

USER node

EXPOSE 3031

CMD ["npm", "start"]
