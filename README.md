# ⚡ پنل دیزاینو وی پی ان | نسخه اختصاصی کلودفلر (Cloudflare Workers Edition)

این نسخه از پروژه **«پنل دیزاینو وی پی ان»** به صورت کاملاً مستقل برای استقرار رایگان، فوق‌العاده سریع و بدون نیاز به VPS روی پلتفرم **Cloudflare Workers** پیاده‌سازی شده است.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Hsdhugdw/claudeflare-dizynopanel)
![Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare_Workers-f38020?style=for-the-badge&logo=cloudflare)
![VLESS over WS](https://img.shields.io/badge/Protocol-VLESS_over_WebSocket-38bdf8?style=for-the-badge)
![Zero Cost](https://img.shields.io/badge/Cost-100%25_Free-34d399?style=for-the-badge)

---

## ✨ ویژگی‌های نسخه کلودفلر

- ⚡ **اتصال VLESS over WebSocket بسیار پرسرعت:** استفاده از قابلیت `cloudflare:sockets` برای اتصال مستقیم TCP و عبور از محدودیت‌ها.
- 📱 **داشبورد مدیریت گرافیکی تک‌فایلی:** شامل فرم راه‌اندازی اولیه، مدیریت کاربران، اسکنر آی‌پی تمیز و صفحه سابسکریپشن همراه با کد QR.
- 💾 **پشتیبانی از دیتابیس کلودفلر (Cloudflare KV):** ذخیره‌سازی دائمی کاربران و تنظیمات بدون پاک شدن پس از آپدیت.
- 🛠️ **اسکریپت نصب خودکار با ۱ کلیک:** نصب آسان روی ویندوز و لینوکس بدون نیاز به دانش فنی.

---

## 🚀 نحوه نصب و راه‌اندازی ۱۰۰٪ خودکار روی کلودفلر

### روش اول: دپلوی اتوماتیک با ۱ کلیک (از روی URL گیت‌هاب) 🌟

1. روی دکمه زیر کلیک کنید:  
   [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Hsdhugdw/claudeflare-dizynopanel)
2. به صورت خودکار پروژه وارد حساب کلودفلر شما شده و بیلد می‌گردد.
3. **نکته مهم پس از اتمام بیلد:** در صفحه داشبورد کلودفلر، در سمت راست بالا روی دکمه **`</> Edit code`** کلیک کرده و سپس دکمه **Visit** یا **Save and deploy** را بزنید تا پنل مدیریت بلافاصله باز شود!

---

### روش دوم: نصب خودکار با اسکریپت ۱ کلیکی (بدون نیاز به تنظیمات دستی) ⚡

اگر ابزار Node.js روی سیستم شما نصب است:

1. وارد پوشه `cloudflare` شوید.
2. روی فایل **`deploy.cmd`** (ویندوز) کلیک کنید یا اسکریپت `deploy.sh` (لینوکس) را اجرا کنید.
3. اسکریپت به صورت ۱۰۰٪ خودکار:
   * حساب کلودفلر شما را متصل می‌کند.
   * دیتابیس ماندگار `DIZYNO_KV` را می‌سازد.
   * دامنه ورکر را روشن کرده و پنل را در مرورگر باز می‌کند!

---

## 💾 اتصال خودکار دیتابیس ماندگار (KV Namespace)

برای این‌که اطلاعات کاربران و ترافیک به صورت دائمی حفظ شود، در داشبورد کلودفلر به زبانه **Settings** -> **Variables & Bindings** بروید و یک **KV Namespace binding** با نام `DIZYNO_KV` ایجاد کرده و **Save and deploy** را بزنید.

---

## 📱 نحوه استفاده کاربران

آدرس ورکر کلودفلر خود را در مرورگر باز کنید (مثلاً `https://dizyno-vpn.your-subdomain.workers.dev`):
1. در اولین باز کردن، **نام کاربری و کلمه عبور ادمین** را تعیین کنید.
2. کاربران جدید بسازید و **لینک سابسکریپشن (`/sub/:uuid`)** آن‌ها را کپی کرده و در نرم‌افزارهای v2rayN، v2rayNG، Shadowrocket یا NekoBox وارد کنید.

---

## 📁 محتوای فایل‌های این پوشه

- `worker.js`: کد جامع و تک‌فایلی ورکر کلودفلر (شامل VLESS WS + UI + API + Sub).
- `wrangler.toml`: فایل کانفیگ پلتفرم Wrangler.
- `deploy.cmd`: اسکریپت نصب خودکار ویندوز.
- `deploy.sh`: اسکریپت نصب خودکار لینوکس و مک.
- `README.md`: راهنمای استقرار نسخه کلودفلر.
