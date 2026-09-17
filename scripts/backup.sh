#!/usr/bin/env bash
# نسخ احتياطي لقاعدة البيانات.
#
# النصوص هي كل شيء: الوسائط تُحذف بعد الاعتماد عمدًا، أما التفريغ
# المدقّق والمعتمد فلا يُعوَّض. لذلك يُنسخ ما في القاعدة وحدها.
#
# الاستعمال:  ./scripts/backup.sh [مجلد]
# في cron يوميًا:  0 3 * * *  /srv/tafreegh/scripts/backup.sh

set -euo pipefail

DIR="${1:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

# ‎.env‎ قد يحوي مسافات وعلامات اقتباس، فنقرأه بـ set -a لا بـ export مباشرة.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL غير مضبوط." >&2
  exit 1
fi

mkdir -p "$DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
TARGET="$DIR/tafreegh_$STAMP.sql.gz"

# نكتب إلى ملف مؤقت ثم نعيد تسميته: النسخة نصف المكتوبة التي يقطعها
# انقطاع تيار تبدو صالحة، وهي أسوأ من غياب النسخة.
TMP="$TARGET.partial"
pg_dump --no-owner --no-acl "$DATABASE_URL" | gzip -9 > "$TMP"
mv "$TMP" "$TARGET"

echo "النسخة: $TARGET ($(du -h "$TARGET" | cut -f1))"

# حذف النسخ الأقدم من المدة المحددة
find "$DIR" -name 'tafreegh_*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete
echo "احتُفظ بنسخ آخر $KEEP_DAYS يومًا."

cat <<'NOTE'

تذكير: نسخة على القرص نفسه ليست نسخة احتياطية.
انسخ المجلد إلى جهاز آخر أو تخزين خارجي (rsync أو rclone).
NOTE
