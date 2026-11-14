FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build
FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3100
CMD ["node","server.js"]

FROM node:24-alpine AS services
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services ./services
COPY --from=build /app/lib ./lib
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/var && chown node:node /app/var
USER node
CMD ["node","--import","tsx","services/worker.ts"]
