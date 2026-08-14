@echo off
chcp 65001 > nul
title اسکریپت نصب خودکار پنل دیزاینو روی کلودفلر (Windows)
echo =======================================================
echo 🚀 به اسکریپت نصب و راه‌اندازی خودکار «پنل دیزاینو کلودفلر» خوش آمدید
echo =======================================================
echo.

echo [1/3] 🔐 ورود و احراز هویت در کلودفلر...
call npx wrangler login

echo.
echo [2/3] 💾 ایجاد خودکار دیتابیس KV ماندگار (DIZYNO_KV)...
call npx wrangler kv:namespace create DIZYNO_KV

echo.
echo [3/3] 🌐 دپلوی، ساخت دامنه و فعال‌سازی خودکار پنل...
call npx wrangler deploy --var WORKERS_DEV:true

echo.
echo =======================================================
echo 🎉 راه‌اندازی با موفقیت انجام شد!
echo 🔗 در حال باز کردن پنل مدیریت در مرورگر...
echo =======================================================
powershell -Command "Start-Process 'https://dash.cloudflare.com/?to=/:account/workers-and-pages'"
pause
