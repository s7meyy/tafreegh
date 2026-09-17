# صورة واحدة تخدم الويب والعامل — الفرق في الأمر لا في المحتوى.
# فصلهما إلى صورتين يضاعف البناء ويضاعف فرص اختلاف النسخ بينهما.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# البناء لا يتصل بقاعدة بيانات؛ القيمة هنا لإرضاء التحقق وقت الحزم فقط.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
ENV AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

# ffmpeg للتفريغ، yt-dlp لجلب الروابط، python3 لتشغيله.
RUN apk add --no-cache ffmpeg python3 py3-pip tini \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV STORAGE_DIR=/data/storage

# مستخدم غير جذر: العامل يشغّل ffmpeg و yt-dlp على مدخلات خارجية.
RUN addgroup -g 1001 tafreegh && adduser -u 1001 -G tafreegh -D tafreegh

COPY --from=builder --chown=tafreegh:tafreegh /app/.next/standalone ./
COPY --from=builder --chown=tafreegh:tafreegh /app/.next/static ./.next/static
COPY --from=builder --chown=tafreegh:tafreegh /app/public ./public

# العامل يعمل من المصدر عبر tsx: الحزمة المستقلة تغطي الويب وحده.
COPY --from=builder --chown=tafreegh:tafreegh /app/node_modules ./node_modules
COPY --from=builder --chown=tafreegh:tafreegh /app/src ./src
COPY --from=builder --chown=tafreegh:tafreegh /app/drizzle ./drizzle
COPY --from=builder --chown=tafreegh:tafreegh /app/package.json ./package.json
COPY --from=builder --chown=tafreegh:tafreegh /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=tafreegh:tafreegh /app/drizzle.config.ts ./drizzle.config.ts

RUN mkdir -p /data/storage && chown -R tafreegh:tafreegh /data
VOLUME /data/storage

USER tafreegh
EXPOSE 3000

# tini يستقبل الإشارات ويحصد العمليات اليتيمة — ffmpeg و yt-dlp
# يخلّفان أبناءً، وبلا حاصد تتراكم عمليات zombie في الحاوية.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
