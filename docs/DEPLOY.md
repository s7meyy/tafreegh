# النشر

خادم واحد بـ Docker Compose (§4.1 من الخطة). مثال: Hetzner CX22 ‏(2 vCPU /
4GB / 40GB) ‏~€4 شهريًا.

## الخطوات

```bash
git clone <المستودع> /srv/tafreegh && cd /srv/tafreegh
cp .env.example .env
```

املأ في `.env`:

```bash
AUTH_SECRET=$(openssl rand -base64 32)       # الموقع لا يقلع بدونه
POSTGRES_PASSWORD=$(openssl rand -base64 24)
DOMAIN=tafreegh.example.com                  # وجّه سجل A إلى الخادم أولًا
GROQ_API_KEY=...
GEMINI_API_KEY=...
```

ثم:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm web npm run db:migrate
```

افتح `https://<نطاقك>/setup` وأنشئ حسابك **فورًا**. الباب يُغلق بعد أول
حساب، لكنه مفتوح لأي زائر قبله.

## ما يفعله الملفّان

| الخدمة | الدور |
|---|---|
| `caddy` | ‏HTTPS بشهادة تلقائية، ترويسات أمان، مهلة طويلة للرفع |
| `web` | الواجهة ومسارات API |
| `worker` | الجلب والتحضير والتفريغ والمراجعة والتنظيف |
| `db` · `redis` | بلا منافذ منشورة — لا تُرى إلا من شبكة compose |

`web` و`worker` من الصورة نفسها، والفرق في الأمر لا في المحتوى. وكلاهما
يركّب حجم `media` نفسه: الرفع يصل إلى الويب والمعالجة تجري في العامل.

## النسخ الاحتياطي

```bash
crontab -e
0 3 * * * cd /srv/tafreegh && ./scripts/backup.sh /srv/backups
```

ثم انسخ `/srv/backups` إلى **جهاز آخر** (`rsync` أو `rclone`). نسخة على
القرص نفسه ليست نسخة احتياطية — عطل القرص يأخذ الاثنين.

النصوص وحدها هي ما يُنسخ: الوسائط تُحذف بعد الاعتماد عمدًا، والتفريغ
المدقّق هو الذي لا يُعوَّض.

## التحديث

```bash
cd /srv/tafreegh && git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml run --rm web npm run db:migrate
```

الترحيل قبل تشغيل العامل على مخطط جديد، لا بعده.

## المتابعة

```bash
docker compose -f docker-compose.prod.yml logs -f worker
docker compose -f docker-compose.prod.yml ps
df -h                                  # الوسائط المؤقتة تأكل القرص
```

الحصص المتبقية تظهر في الموقع على صفحة «المهام والحصص».

## حين يمتلئ القرص

الوسائط تُحذف بعد الاعتماد، ويكنس العاملُ المهجورَ منها بعد
`MEDIA_TTL_DAYS`. إن امتلأ رغم ذلك:

```bash
docker compose -f docker-compose.prod.yml exec worker du -sh /data/storage/*
docker system prune -a                 # صور وطبقات قديمة
```

وراجع `MEDIA_TTL_DAYS` — الافتراضي 14 يومًا، وخفضه يحرّر مساحة أسرع.

## ما لا يغطيه هذا الدليل

- **الوضع المحلي** (`LOCAL_ASR_COMMAND`) يحتاج `faster-whisper` داخل
  الصورة ومعالجًا قويًا أو GPU. الصورة الحالية لا تتضمّنه.
- **تعدد الخوادم** — البنية تحتمله (الحالة كلها في Postgres وRedis) لكنها
  لم تُجرَّب عليه، ويحتاج تخزينًا مشتركًا بدل حجم Docker المحلي.
