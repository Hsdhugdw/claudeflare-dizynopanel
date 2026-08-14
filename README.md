# ⚡ پنل دیزاینو وی پی ان | نسخه اختصاصی کلودفلر (Cloudflare Workers Edition)

این نسخه از پروژه **«پنل دیزاینو وی پی ان»** به صورت کاملاً مستقل برای استقرار رایگان، فوق‌العاده سریع و بدون نیاز به VPS روی پلتفرم **Cloudflare Workers** پیاده‌سازی شده است.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/YOUR_CLOUDFLARE_REPO)
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

## 🚀 روش‌های نصب و استقرار روی کلودفلر

### روش اول: ساده‌ترین روش (کپی-پیست در مرورگر بدون نصب ابزار) 🌟

1. وارد حساب کاربری خود در [Cloudflare Dashboard](https://dash.cloudflare.com) شوید.
2. از منوی سمت چپ به بخش **Workers & Pages** بروید و روی **Create Application** و سپس **Create Worker** کلیک کنید.
3. یک نام برای ورکر خود انتخاب کنید (مثلاً `dizyno-vpn`) و روی **Deploy** کلیک کنید.
4. روی دکمه **Edit code** کلیک کنید تا ادیتور درون مرورگر باز شود.
5. تمام محتوای فایل [`worker.js`](./worker.js) موجود در همین پوشه را کپی کرده و جایگزین کد قبلی در ادیتور کلودفلر کنید.
6. روی دکمه **Save and deploy** کلیک کنید.
7. آدرس ورکر شما (مثلاً `https://dizyno-vpn.subdomain.workers.dev`) آماده استفاده است!

---

### روش دوم: نصب خودکار با اسکریپت ۱ کلیکی (ویژه ویندوز و لینوکس) ⚡

اگر ابزار Node.js روی سیستم شما نصب است:

#### 🪟 در ویندوز (Windows):
کافیست روی فایل `deploy.cmd` دو بار کلیک کنید! اسکریپت به صورت خودکار:
1. شما را وارد حساب کلودفلر می‌کند.
2. دیتابیس KV را می‌سازد.
3. ورکر را دپلوی می‌کند.

#### 🐧 در لینوکس و مک (Linux / Mac):
دستور زیر را در ترمینال اجرا کنید:
```bash
chmod +x deploy.sh
./deploy.sh
```

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
