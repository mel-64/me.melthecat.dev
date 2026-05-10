FROM node:alpine as builder

ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --chown=node:node . .
RUN npm install .

FROM node:alpine as runner
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=builder /usr/src/app .

RUN chown node:node /usr/src/app

USER node
CMD ["npm", "run", "app"]
