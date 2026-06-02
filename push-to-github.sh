#!/usr/bin/env bash
# ============================================================
#  push ขึ้น GitHub แบบรวดเร็ว
#  วิธีใช้:
#     1) สร้าง repo เปล่า ๆ บน github.com ก่อน (อย่าติ๊ก Add README)
#     2) คัดลอก URL ของ repo มา เช่น https://github.com/USER/REPO.git
#     3) รัน:  bash push-to-github.sh https://github.com/USER/REPO.git
# ============================================================
set -e

REPO_URL="$1"
if [ -z "$REPO_URL" ]; then
  echo "❌ กรุณาใส่ URL ของ repo"
  echo "   ตัวอย่าง: bash push-to-github.sh https://github.com/USER/REPO.git"
  exit 1
fi

# ออกจากโฟลเดอร์ script ไปยังโฟลเดอร์โปรเจกต์ (ที่เดียวกัน)
cd "$(dirname "$0")"

git init
git add -A
git commit -m "FLASH TRACK: ระบบติดตาม/จัดการพัสดุ (Supabase)"
git branch -M main
git remote add origin "$REPO_URL" 2>/dev/null || git remote set-url origin "$REPO_URL"
git push -u origin main

echo ""
echo "✅ push เรียบร้อย!"
echo "👉 ไปเปิด GitHub Pages ต่อ: repo → Settings → Pages → Source: Deploy from a branch → main / (root)"
