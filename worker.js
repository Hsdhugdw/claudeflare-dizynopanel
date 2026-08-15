/**
 * ورکر اختصاصی «دیزاینو وی پی ان» (Dizyno VPN Panel - Cloudflare Workers Edition)
 * پشتیبانی کامل از VLESS/Trojan over WebSocket، دیتابیس KV، سابسکریپشن هوشمند،
 * سیستم ربات تلگرام تعاملی با دکمه اتصال مستقیم وب‌هوک از فرانت‌اند،
 * بخش اختصاصی تنظیمات تلگرام و کنتراست بالای فوق‌العاده.
 */

import { connect } from 'cloudflare:sockets';

const DEFAULT_SETTINGS = {
  isConfigured: false,
  username: '',
  password: '',
  cleanIp: '',
  enableVlessWs: true,
  enableTrojanWs: true,
  telegramBotToken: '',
  telegramAdminId: ''
};

// حافظه ماندگار درون‌برنامه
let globalMemoryStore = {
  settings: { ...DEFAULT_SETTINGS },
  users: []
};

// دریافت دیتابیس فعال KV
function getKvBinding(env) {
  if (!env) return null;
  return env.DIZYNO_KV || env.USERS_KV || env.KV || null;
}

// تابع تبدیل امن رشته‌های فارسی و UTF-8 به Base64
function safeBase64(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (e) {
    return btoa(unescape(encodeURIComponent(str)));
  }
}

// دریافت تنظیمات
async function getSettings(env) {
  const kv = getKvBinding(env);
  if (kv) {
    try {
      const data = await kv.get('settings', 'json');
      if (data) return { ...DEFAULT_SETTINGS, ...data };
    } catch (e) {}
  }
  return globalMemoryStore.settings;
}

// ذخیره تنظیمات
async function saveSettings(env, settings) {
  globalMemoryStore.settings = settings;
  const kv = getKvBinding(env);
  if (kv) {
    try {
      await kv.put('settings', JSON.stringify(settings));
    } catch (e) {}
  }
}

// دریافت کاربران
async function getUsers(env) {
  const kv = getKvBinding(env);
  if (kv) {
    try {
      const data = await kv.get('users', 'json');
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {}
  }
  return globalMemoryStore.users;
}

// ذخیره کاربران
async function saveUsers(env, users) {
  globalMemoryStore.users = users;
  const kv = getKvBinding(env);
  if (kv) {
    try {
      await kv.put('users', JSON.stringify(users));
    } catch (e) {}
  }
}

// لیست آی‌پی‌های تمیز پیشنهادی
const PRESET_CLEAN_IPS = [
  { ip: '162.159.192.1', name: 'Cloudflare Clean IP #1', latency: 'مناسب IR' },
  { ip: '162.159.193.1', name: 'Cloudflare Clean IP #2', latency: 'مناسب همراه اول' },
  { ip: '104.16.132.229', name: 'Cloudflare Clean IP #3', latency: 'مناسب ایرانسل' },
  { ip: '104.17.147.22', name: 'Cloudflare Clean IP #4', latency: 'مناسب رایتل / شاتل' },
  { ip: '172.67.182.10', name: 'Cloudflare Clean IP #5', latency: 'پایدار و پرسرعت' }
];

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get('Upgrade');

      // هندل کردن اتصال VLESS و Trojan over WebSocket
      if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
        return await handleVlessWebSocket(request, env);
      }

      const path = url.pathname;

      // API وب‌هوک ربات تلگرام
      if (path === '/api/telegram-webhook' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        await handleTelegramWorkerUpdate(body, env, url.origin);
        return jsonResponse({ success: true });
      }

      // API ست کردن خودکار وب‌هوک تلگرام
      if (path === '/api/set-telegram-webhook' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const settings = await getSettings(env);
        const token = (body.token || settings.telegramBotToken || '').trim();
        const adminId = (body.adminId || settings.telegramAdminId || '').trim();

        if (!token) {
          return jsonResponse({ success: false, message: 'لطفاً ابتدا توکن ربات تلگرام (BotFather Token) را وارد کنید.' }, 400);
        }

        // ذخیره فوری توکن و چت آی‌دی در تنظیمات
        settings.telegramBotToken = token;
        if (adminId) settings.telegramAdminId = adminId;
        await saveSettings(env, settings);

        const webhookUrl = `${url.origin}/api/telegram-webhook`;
        const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
        const data = await res.json();

        if (data.ok) {
          return jsonResponse({
            success: true,
            message: `✅ ربات تلگرام با موفقیت به پنل کلودفلر متصل گردید!\n\nآدرس وب‌هوک ثبت‌شده:\n${webhookUrl}`,
            webhookUrl
          });
        } else {
          return jsonResponse({ success: false, message: 'خطا در ثبت وب‌هوک تلگرام: ' + (data.description || 'توکن نامعتبر است') }, 400);
        }
      }

      // API بررسی وضعیت راه‌اندازی
      if (path === '/api/setup-status') {
        const settings = await getSettings(env);
        const users = await getUsers(env);
        const kvBound = !!getKvBinding(env);
        return jsonResponse({ success: true, isConfigured: !!settings.isConfigured, hasUsers: users.length > 0, kvBound });
      }

      // API راه‌اندازی اولیه
      if (path === '/api/setup-initial' && request.method === 'POST') {
        const body = await request.json();
        const settings = await getSettings(env);

        if (settings.isConfigured) {
          return jsonResponse({ success: false, message: 'پنل قبلاً پیکربندی شده است.' }, 400);
        }

        if (!body.username || !body.password) {
          return jsonResponse({ success: false, message: 'نام کاربری و کلمه عبور الزامی است.' }, 400);
        }

        settings.username = body.username.trim();
        settings.password = body.password.trim();
        if (body.cleanIp) settings.cleanIp = body.cleanIp.trim();
        settings.isConfigured = true;

        await saveSettings(env, settings);
        return jsonResponse({ success: true, message: 'راه‌اندازی اولیه انجام شد.' });
      }

      // API ورود
      if (path === '/api/login' && request.method === 'POST') {
        const body = await request.json();
        const settings = await getSettings(env);

        if (body.username === settings.username && body.password === settings.password) {
          return jsonResponse({ success: true, message: 'ورود موفقیت‌آمیز بود.' });
        }
        return jsonResponse({ success: false, message: 'اطلاعات ورود اشتباه است.' }, 400);
      }

      // API دریافت تنظیمات
      if (path === '/api/settings') {
        const settings = await getSettings(env);
        return jsonResponse({ success: true, settings });
      }

      // API تغییر تنظیمات
      if (path === '/api/settings' && request.method === 'POST') {
        const body = await request.json();
        const settings = await getSettings(env);

        if (body.username) settings.username = body.username.trim();
        if (body.password) settings.password = body.password.trim();
        if (body.cleanIp !== undefined) settings.cleanIp = body.cleanIp.trim();
        if (body.telegramBotToken !== undefined) settings.telegramBotToken = body.telegramBotToken.trim();
        if (body.telegramAdminId !== undefined) settings.telegramAdminId = body.telegramAdminId.trim();

        await saveSettings(env, settings);

        // ست کردن خودکار وب‌هوک تلگرام در صورت وجود توکن
        if (settings.telegramBotToken) {
          try {
            const webhookUrl = `${url.origin}/api/telegram-webhook`;
            await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
          } catch (e) {}
        }

        return jsonResponse({ success: true, message: 'تنظیمات با موفقیت به‌روزرسانی شد.' });
      }

      // API دریافت کاربران
      if (path === '/api/users' && request.method === 'GET') {
        const users = await getUsers(env);
        return jsonResponse({ success: true, users });
      }

      // API ساخت کاربر
      if (path === '/api/users' && request.method === 'POST') {
        const body = await request.json();
        const users = await getUsers(env);

        if (!body.name || !body.name.trim()) {
          return jsonResponse({ success: false, message: 'نام کاربر الزامی است.' }, 400);
        }

        let expireDate = null;
        if (body.expireDays && parseInt(body.expireDays) > 0) {
          const d = new Date();
          d.setDate(d.getDate() + parseInt(body.expireDays));
          expireDate = d.toISOString().split('T')[0];
        }

        const newUuid = crypto.randomUUID();
        const newUser = {
          id: newUuid,
          uuid: newUuid,
          name: body.name.trim(),
          limitBytes: body.limitGB ? parseFloat(body.limitGB) * 1024 * 1024 * 1024 : 0,
          usedBytes: 0,
          expireDate: expireDate,
          status: 'active',
          createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await saveUsers(env, users);
        return jsonResponse({ success: true, message: 'کاربر جدید با موفقیت ایجاد شد.', user: newUser });
      }

      // API حذف کاربر
      if (path.startsWith('/api/users/')) {
        const parts = path.split('/');
        const userId = parts[3];
        const users = await getUsers(env);
        const index = users.findIndex(u => u.id === userId || u.uuid === userId);

        if (index === -1) return jsonResponse({ success: false, message: 'کاربر یافت نشد.' }, 404);

        if (request.method === 'DELETE') {
          users.splice(index, 1);
          await saveUsers(env, users);
          return jsonResponse({ success: true, message: 'کاربر حذف شد.' });
        }
      }

      // API لیست آی‌پی‌های تمیز
      if (path === '/api/clean-ips') {
        const settings = await getSettings(env);
        return jsonResponse({ success: true, currentCleanIp: settings.cleanIp || '', presetIps: PRESET_CLEAN_IPS });
      }

      // مسیر سابسکریپشن هوشمند (/sub/:uuid)
      if (path.includes('/sub/')) {
        const rawUuid = path.split('/sub/')[1] || '';
        const cleanUuid = rawUuid.split('/')[0].split('?')[0].trim().toLowerCase();

        const users = await getUsers(env);
        const user = users.find(u => (u.uuid && u.uuid.toLowerCase() === cleanUuid) || u.id === cleanUuid);

        if (!user) {
          return new Response('User Not Found / کاربر یافت نشد', { status: 404 });
        }

        const settings = await getSettings(env);
        const host = url.hostname;
        const connectAddress = settings.cleanIp && settings.cleanIp.trim() !== '' ? settings.cleanIp.trim() : host;

        const configsList = [
          `vless://${user.uuid}@${connectAddress}:443?type=ws&path=%2Fvless&security=tls&encryption=none&fp=chrome&sni=${host}&host=${host}#${encodeURIComponent(user.name + ' | VLESS-WS')}`,
          `trojan://${user.uuid}@${connectAddress}:443?type=ws&path=%2Ftrojan&security=tls&fp=chrome&sni=${host}&host=${host}#${encodeURIComponent(user.name + ' | Trojan-WS')}`
        ];

        if (connectAddress !== host) {
          configsList.push(`vless://${user.uuid}@${host}:443?type=ws&path=%2Fvless&security=tls&encryption=none&fp=chrome&sni=${host}&host=${host}#${encodeURIComponent(user.name + ' | VLESS-Direct')}`);
        }

        const combinedConfigs = configsList.join('\n');
        const base64Config = safeBase64(combinedConfigs);

        const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
        const secChUa = request.headers.get('sec-ch-ua');
        const acceptLang = request.headers.get('accept-language');
        const isVpnClient = /v2ray|xray|shadowrocket|nekobox|sing-box|clash|stash|quantumult|streisand|passwall|sagernet|surfboard|hiddify|flclash|matsuri|v2fly|go-http-client|axios|fetch|curl|wget/i.test(userAgent);

        const forceHtml = url.searchParams.get('html') === 'true';
        const forceRaw = url.searchParams.get('raw') === 'true' || url.searchParams.get('format') === 'base64';

        const isRealBrowser = (secChUa || acceptLang) && userAgent.includes('mozilla') && !isVpnClient;

        if ((forceHtml || isRealBrowser) && !forceRaw) {
          return new Response(renderSubHtml(user, url.origin, combinedConfigs), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }

        const expireTimestamp = user.expireDate ? Math.floor(new Date(user.expireDate).getTime() / 1000) : 0;
        return new Response(base64Config, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Subscription-Userinfo': `upload=0; download=${user.usedBytes}; total=${user.limitBytes || 0}; expire=${expireTimestamp}`,
            'profile-title': `base64:${safeBase64(user.name)}`,
            'profile-update-interval': '24'
          }
        });
      }

      // رندر داشبورد اصلی مدیریت
      return new Response(renderDashboardHtml(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (err) {
      return new Response('Internal Server Error: ' + err.message, { status: 500 });
    }
  }
};

// ---- سیستم ربات تلگرام تعاملی کلودفلر (Stateful Wizard) ----

const workerBotStateMap = {}; // حافظه پایش مراحل ساخت کاربر در تلگرام کلودفلر

async function answerWorkerCallbackQuery(env, callbackQueryId, text = '') {
  const settings = await getSettings(env);
  if (!settings.telegramBotToken) return;

  await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
  });
}

// پاسخ JSON استاندارد
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// ارسال پیام تلگرام در نسخه کلودفلر ورکر با HTML Parse Mode
async function sendTelegramWorkerMessage(env, text, replyMarkup = null, customChatId = null) {
  const settings = await getSettings(env);
  if (!settings.telegramBotToken) return;

  const chatId = customChatId || settings.telegramAdminId;
  if (!chatId) return;

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function getTelegramWorkerMainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: '📊 آمار سرور' }, { text: '👥 مدیریت و لیست کاربران' }],
      [{ text: '➕ ساخت کاربر جدید (ویزارد)' }, { text: '🔍 استعلام سریع' }]
    ],
    resize_keyboard: true,
    persistent: true
  };
}

// پردازش دستورات ورودی و اینلاین کیبوردهای تلگرام در کلودفلر
async function handleTelegramWorkerUpdate(update, env, origin) {
  const settings = await getSettings(env);

  // ۱. پردازش کلیک روی دکمه‌های اینلاین (Callback Query)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const data = cb.data;

    if (settings.telegramAdminId && chatId.toString() !== settings.telegramAdminId.toString()) {
      await answerWorkerCallbackQuery(env, cb.id, '⛔ دسترسی غیرمجاز.');
      return;
    }

    await answerWorkerCallbackQuery(env, cb.id);

    // انتخاب حجم در ویزارد ساخت کاربر
    if (data.startsWith('c_limit_')) {
      const limitGB = parseFloat(data.replace('c_limit_', ''));
      if (!workerBotStateMap[chatId]) workerBotStateMap[chatId] = {};
      workerBotStateMap[chatId].limitGB = limitGB;
      workerBotStateMap[chatId].step = 'await_days';

      const daysMarkup = {
        inline_keyboard: [
          [{ text: '7 روز', callback_data: 'c_days_7' }, { text: '30 روز', callback_data: 'c_days_30' }],
          [{ text: '60 روز', callback_data: 'c_days_60' }, { text: '90 روز', callback_data: 'c_days_90' }],
          [{ text: '♾️ نامحدود', callback_data: 'c_days_0' }]
        ]
      };

      await sendTelegramWorkerMessage(
        env,
        `⏳ <b>مرحله ۳ از ۳: تعیین مدت زمان اعتبار</b>\n\n` +
        `نام: <b>${workerBotStateMap[chatId].name}</b>\n` +
        `حجم: <b>${limitGB > 0 ? limitGB + ' GB' : 'نامحدود'}</b>\n\n` +
        `لطفاً مدت اعتبار را انتخاب کنید یا عدد تایپ نمایید:`,
        daysMarkup,
        chatId
      );
      return;
    }

    // انتخاب روز در ویزارد ساخت کاربر و تکمیل ثبت
    if (data.startsWith('c_days_')) {
      const expireDays = parseInt(data.replace('c_days_', ''));
      const state = workerBotStateMap[chatId] || {};
      const name = state.name || 'کاربر جدید';
      const limitGB = state.limitGB || 0;

      delete workerBotStateMap[chatId]; // پاکسازی وضعیت

      const users = await getUsers(env);
      let expireDate = null;
      if (expireDays > 0) {
        const d = new Date();
        d.setDate(d.getDate() + expireDays);
        expireDate = d.toISOString().split('T')[0];
      }

      const newUuid = crypto.randomUUID();
      const newUser = {
        id: newUuid,
        uuid: newUuid,
        name: name.trim(),
        limitBytes: limitGB * 1024 * 1024 * 1024,
        usedBytes: 0,
        expireDate: expireDate,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      users.push(newUser);
      await saveUsers(env, users);

      const subUrl = `${origin}/sub/${newUser.uuid}`;

      await sendTelegramWorkerMessage(
        env,
        `🎉 <b>کاربر با موفقیت در کلودفلر ایجاد شد!</b>\n\n` +
        `👤 <b>نام:</b> ${newUser.name}\n` +
        `📊 <b>حجم:</b> ${limitGB > 0 ? limitGB + ' GB' : 'نامحدود'}\n` +
        `⏳ <b>اعتبار:</b> ${expireDays > 0 ? expireDays + ' روز' : 'نامحدود'}\n\n` +
        `🔑 <b>UUID:</b> <code>${newUser.uuid}</code>\n\n` +
        `🔗 <b>لینک سابسکریپشن:</b>\n<code>${subUrl}</code>`,
        getTelegramWorkerMainMenuKeyboard(),
        chatId
      );
      return;
    }

    // مشاهده مشخصات و دکمه‌های کاربر انتخاب‌شده
    if (data.startsWith('u_det_')) {
      const userId = data.replace('u_det_', '');
      await sendWorkerUserManagementCard(env, userId, chatId, origin);
      return;
    }

    // دریافت مستقیم لینک ساب
    if (data.startsWith('u_sub_')) {
      const userId = data.replace('u_sub_', '');
      const users = await getUsers(env);
      const user = users.find(u => u.id === userId || u.uuid === userId);
      if (user) {
        const subUrl = `${origin}/sub/${user.uuid}`;
        await sendTelegramWorkerMessage(
          env,
          `🔗 <b>لینک سابسکریپشن کاربر ${user.name}:</b>\n\n` +
          `<code>${subUrl}</code>`,
          null,
          chatId
        );
      }
      return;
    }

    // صفر کردن مصرف کاربر
    if (data.startsWith('u_reset_')) {
      const userId = data.replace('u_reset_', '');
      const users = await getUsers(env);
      const user = users.find(u => u.id === userId || u.uuid === userId);
      if (user) {
        user.usedBytes = 0;
        await saveUsers(env, users);
        await sendTelegramWorkerMessage(env, `🔄 ترافیک مصرفی کاربر <b>${user.name}</b> صفر گردید.`, null, chatId);
        await sendWorkerUserManagementCard(env, user.id, chatId, origin);
      }
      return;
    }

    // تغییر وضعیت فعال / غیرفعال
    if (data.startsWith('u_toggle_')) {
      const userId = data.replace('u_toggle_', '');
      const users = await getUsers(env);
      const user = users.find(u => u.id === userId || u.uuid === userId);
      if (user) {
        user.status = user.status === 'active' ? 'disabled' : 'active';
        await saveUsers(env, users);
        await sendTelegramWorkerMessage(env, `وضعیت کاربر <b>${user.name}</b> به <b>${user.status === 'active' ? 'فعال' : 'غیرفعال'}</b> تغییر یافت.`, null, chatId);
        await sendWorkerUserManagementCard(env, user.id, chatId, origin);
      }
      return;
    }

    // حذف کاربر
    if (data.startsWith('u_del_')) {
      const userId = data.replace('u_del_', '');
      const users = await getUsers(env);
      const index = users.findIndex(u => u.id === userId || u.uuid === userId);
      if (index !== -1) {
        const userName = users[index].name;
        users.splice(index, 1);
        await saveUsers(env, users);
        await sendTelegramWorkerMessage(env, `🗑️ کاربر <b>${userName}</b> با موفقیت حذف گردید.`, getTelegramWorkerMainMenuKeyboard(), chatId);
      }
      return;
    }
  }

  // ۲. پردازش پیام‌های متنی
  if (!update || !update.message || !update.message.text) return;

  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (settings.telegramAdminId && chatId.toString() !== settings.telegramAdminId.toString()) {
    await sendTelegramWorkerMessage(env, '⛔ دسترسی غیرمجاز. این ربات تنها برای مدیریت سرور تنظیم شده است.', null, chatId);
    return;
  }

  // اگر کاربر در حال طی کردن مراحل ویزارد است
  if (workerBotStateMap[chatId]) {
    const state = workerBotStateMap[chatId];

    if (state.step === 'await_name') {
      state.name = text;
      state.step = 'await_limit';

      const limitMarkup = {
        inline_keyboard: [
          [{ text: '10 GB', callback_data: 'c_limit_10' }, { text: '30 GB', callback_data: 'c_limit_30' }],
          [{ text: '50 GB', callback_data: 'c_limit_50' }, { text: '100 GB', callback_data: 'c_limit_100' }],
          [{ text: '♾️ نامحدود', callback_data: 'c_limit_0' }]
        ]
      };

      await sendTelegramWorkerMessage(
        env,
        `📊 <b>مرحله ۲ از ۳: تعیین حجم مجاز (GB)</b>\n\n` +
        `نام کاربر: <b>${text}</b>\n\n` +
        `لطفاً یکی از حجم‌های زیر را انتخاب کنید یا عدد تایپ کنید:`,
        limitMarkup,
        chatId
      );
      return;
    }

    if (state.step === 'await_limit') {
      const limitGB = parseFloat(text) || 0;
      state.limitGB = limitGB;
      state.step = 'await_days';

      const daysMarkup = {
        inline_keyboard: [
          [{ text: '7 روز', callback_data: 'c_days_7' }, { text: '30 روز', callback_data: 'c_days_30' }],
          [{ text: '60 روز', callback_data: 'c_days_60' }, { text: '90 روز', callback_data: 'c_days_90' }],
          [{ text: '♾️ نامحدود', callback_data: 'c_days_0' }]
        ]
      };

      await sendTelegramWorkerMessage(
        env,
        `⏳ <b>مرحله ۳ از ۳: تعیین مدت زمان اعتبار (روز)</b>\n\n` +
        `نام: <b>${state.name}</b> | حجم: <b>${limitGB > 0 ? limitGB + ' GB' : 'نامحدود'}</b>\n\n` +
        `لطفاً مدت اعتبار را انتخاب کنید یا عدد تایپ نمایید:`,
        daysMarkup,
        chatId
      );
      return;
    }

    if (state.step === 'await_days') {
      const expireDays = parseInt(text) || 0;
      const name = state.name || 'کاربر جدید';
      const limitGB = state.limitGB || 0;

      delete workerBotStateMap[chatId];

      const users = await getUsers(env);
      let expireDate = null;
      if (expireDays > 0) {
        const d = new Date();
        d.setDate(d.getDate() + expireDays);
        expireDate = d.toISOString().split('T')[0];
      }

      const newUuid = crypto.randomUUID();
      const newUser = {
        id: newUuid,
        uuid: newUuid,
        name: name.trim(),
        limitBytes: limitGB * 1024 * 1024 * 1024,
        usedBytes: 0,
        expireDate: expireDate,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      users.push(newUser);
      await saveUsers(env, users);

      const subUrl = `${origin}/sub/${newUser.uuid}`;

      await sendTelegramWorkerMessage(
        env,
        `🎉 <b>کاربر با موفقیت در کلودفلر ایجاد شد!</b>\n\n` +
        `👤 <b>نام:</b> ${newUser.name}\n` +
        `📊 <b>حجم:</b> ${limitGB > 0 ? limitGB + ' GB' : 'نامحدود'}\n` +
        `⏳ <b>اعتبار:</b> ${expireDays > 0 ? expireDays + ' روز' : 'نامحدود'}\n\n` +
        `🔑 <b>UUID:</b> <code>${newUser.uuid}</code>\n\n` +
        `🔗 <b>لینک سابسکریپشن:</b>\n<code>${subUrl}</code>`,
        getTelegramWorkerMainMenuKeyboard(),
        chatId
      );
      return;
    }
  }

  if (text === '/start' || text === 'منو' || text === 'menu') {
    delete workerBotStateMap[chatId];
    await sendTelegramWorkerMessage(
      env,
      `⚡ <b>به ربات مدیریتی «دیزاینو وی پی ان» (Cloudflare Edition) خوش آمدید!</b>\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:`,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
    return;
  }

  // شروع ویزارد ساخت کاربر جدید
  if (text === '➕ ساخت کاربر جدید (ویزارد)' || text === '/create') {
    workerBotStateMap[chatId] = { step: 'await_name' };
    await sendTelegramWorkerMessage(
      env,
      `📝 <b>مرحله ۱ از ۳: نام کاربر</b>\n\n` +
      `لطفاً نام کاربر جدید را تایپ و ارسال نمایید:\n` +
      `(مثال: <code>ali_user</code>)`,
      null,
      chatId
    );
    return;
  }

  if (text === '📊 آمار سرور' || text === '/stats') {
    const users = await getUsers(env);
    const today = new Date().toISOString().split('T')[0];

    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === 'active' && (!u.expireDate || u.expireDate >= today) && (u.limitBytes === 0 || u.usedBytes < u.limitBytes)).length;
    const expiredUsers = users.filter(u => (u.expireDate && u.expireDate < today) || (u.limitBytes > 0 && u.usedBytes >= u.limitBytes)).length;

    const totalUsedBytes = users.reduce((acc, u) => acc + (u.usedBytes || 0), 0);
    const usedGB = (totalUsedBytes / (1024 * 1024 * 1024)).toFixed(2);

    await sendTelegramWorkerMessage(
      env,
      `📊 <b>آمار کلی پنل دیزاینو کلودفلر:</b>\n\n` +
      `👥 <b>کل کاربران:</b> ${totalUsers} نفر\n` +
      `✅ <b>کاربران فعال:</b> ${activeUsers} نفر\n` +
      `❌ <b>کاربران منقضی:</b> ${expiredUsers} نفر\n` +
      `🌐 <b>کل ترافیک مصرفی:</b> ${usedGB} GB`,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
    return;
  }

  // لیست کاربران به صورت اینلاین کلیک‌پذیر
  if (text === '👥 مدیریت و لیست کاربران' || text === '/users' || text === '🔍 استعلام سریع') {
    await sendWorkerUsersInlineList(env, chatId);
    return;
  }
}

// مدیریت VLESS over WebSocket سوکت دایرکت کلودفلر با پینگ سبز واقعی
async function handleVlessWebSocket(request, env) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  let remoteSocket = null;
  let isHeaderParsed = false;

  server.addEventListener('message', async (event) => {
    try {
      const buffer = new Uint8Array(event.data);

      if (!isHeaderParsed) {
        if (buffer.length < 22) return;

        const vlessVersion = buffer[0];
        const optLength = buffer[17];
        let cursor = 18 + optLength;

        const command = buffer[cursor];
        cursor++;

        const port = (buffer[cursor] << 8) | buffer[cursor + 1];
        cursor += 2;

        const addressType = buffer[cursor];
        cursor++;

        let address = '';
        if (addressType === 1) {
          address = `${buffer[cursor]}.${buffer[cursor+1]}.${buffer[cursor+2]}.${buffer[cursor+3]}`;
          cursor += 4;
        } else if (addressType === 2) {
          const domainLen = buffer[cursor];
          cursor++;
          address = new TextDecoder().decode(buffer.subarray(cursor, cursor + domainLen));
          cursor += domainLen;
        } else if (addressType === 3) {
          const ipv6Bytes = buffer.subarray(cursor, cursor + 16);
          address = Array.from(ipv6Bytes).map(b => b.toString(16).padStart(2, '0')).join('').match(/.{1,4}/g).join(':');
          cursor += 16;
        }

        if (!address || !port || port <= 0 || port > 65535) return;

        isHeaderParsed = true;
        server.send(new Uint8Array([vlessVersion, 0]));

        remoteSocket = connect({ hostname: address, port });
        const writer = remoteSocket.writable.getWriter();

        const rawData = buffer.subarray(cursor);
        if (rawData.length > 0) {
          writer.write(rawData);
        }
        writer.releaseLock();

        remoteSocket.readable.pipeTo(new WritableStream({
          write(chunk) {
            try { server.send(chunk); } catch(e){}
          },
          close() {
            try { server.close(); } catch(e){}
          },
          abort(err) {
            try { server.close(); } catch(e){}
          }
        }));
      } else {
        if (remoteSocket && remoteSocket.writable) {
          const writer = remoteSocket.writable.getWriter();
          writer.write(buffer);
          writer.releaseLock();
        }
      }
    } catch (err) {
      try { server.close(); } catch(e){}
    }
  });

  server.addEventListener('close', () => {
    if (remoteSocket) try { remoteSocket.close(); } catch(e){}
  });

  server.addEventListener('error', () => {
    if (remoteSocket) try { remoteSocket.close(); } catch(e){}
  });

  return new Response(null, {
    status: 101,
    webSocket: client
  });
}

// رندر صفحه وب سابسکریپشن کاربر
function renderSubHtml(user, origin, configLinks) {
  const usedGB = (user.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
  const limitGB = user.limitBytes > 0 ? (user.limitBytes / (1024 * 1024 * 1024)).toFixed(2) : 'نامحدود';
  const subUrl = `${origin}/sub/${user.uuid}`;

  let daysRemainingText = 'نامحدود';
  if (user.expireDate) {
    const diffDays = Math.ceil((new Date(user.expireDate) - new Date()) / (1024 * 60 * 60 * 24));
    daysRemainingText = diffDays > 0 ? `${diffDays} روز باقی‌مانده` : 'منقضی شده';
  }

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>دیزاینو وی پی ان | وضعیت اشتراک ${user.name}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
  <style>
    body { font-family: 'Vazirmatn', sans-serif; background: #070a13; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; margin: 0; }
    .card-box { background: #0f172a; border: 1px solid #334155; border-radius: 28px; padding: 28px; max-width: 450px; width: 100%; box-shadow: 0 25px 60px rgba(0,0,0,0.6); }
    .qr-box { background: #fff; padding: 12px; border-radius: 20px; display: inline-block; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
    .btn-action { border-radius: 14px; padding: 14px; font-weight: 700; transition: all 0.25s ease; }
    .btn-action:hover { transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="card-box text-center">
    <div class="d-flex align-items-center justify-content-between mb-4">
      <div class="d-flex align-items-center gap-2 text-start">
        <div class="bg-primary text-white p-2.5 rounded-3 d-flex align-items-center justify-content-center" style="width:44px; height:44px;">
          <i class="fa-solid fa-bolt fs-5"></i>
        </div>
        <div>
          <h5 class="fw-bold text-white mb-0">${user.name}</h5>
          <span class="text-slate-400 small" style="font-size:0.8rem;">دیزاینو وی پی ان | Cloudflare</span>
        </div>
      </div>
      <span class="badge bg-success rounded-pill px-3 py-2">فعال</span>
    </div>
    
    <div class="p-3 bg-dark rounded-4 mb-4 text-start small border border-secondary border-opacity-25">
      <div class="d-flex justify-content-between mb-2">
        <span class="text-slate-400">حجم مصرفی:</span>
        <strong class="text-info fs-6">${usedGB} GB / ${limitGB} ${limitGB !== 'نامحدود' ? 'GB' : ''}</strong>
      </div>
      <div class="d-flex justify-content-between">
        <span class="text-slate-400">اعتبار زمانی:</span>
        <strong class="text-warning fs-6">${daysRemainingText}</strong>
      </div>
    </div>

    <div class="qr-box mb-4">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(subUrl)}" width="180" height="180" alt="QR Code">
    </div>

    <div class="d-grid gap-2">
      <button class="btn btn-primary btn-action" onclick="navigator.clipboard.writeText('${subUrl}').then(() => alert('لینک سابسکریپشن کپی شد!'))">
        <i class="fa-solid fa-link me-2"></i> کپی لینک ساب (Subscription)
      </button>
      <button class="btn btn-outline-light btn-action" onclick="navigator.clipboard.writeText(\`${configLinks}\`).then(() => alert('تمامی کانفیگ‌های VLESS و Trojan کپی شدند!'))">
        <i class="fa-solid fa-copy me-2"></i> کپی مستقیم کانفیگ‌ها
      </button>
    </div>
  </div>
</body>
</html>`;
}

// رندر کامل داشبورد گرافیکی فوق‌العاده با کادر شفاف و شیک ربات تلگرام
function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>پنل دیزاینو وی پی ان | نسخه Cloudflare Workers</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
  <style>
    :root, [data-theme="dark"] {
      --bg-main: #070a13;
      --bg-card: #0f172a;
      --bg-card-header: #1e293b;
      --bg-input: #1e293b;
      --border-color: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #94a3b8;
    }
    [data-theme="light"] {
      --bg-main: #f1f5f9;
      --bg-card: #ffffff;
      --bg-card-header: #f8fafc;
      --bg-input: #ffffff;
      --border-color: #cbd5e1;
      --text-primary: #0f172a;
      --text-secondary: #334155;
      --text-muted: #64748b;
    }
    body { font-family: 'Vazirmatn', sans-serif; background: var(--bg-main); color: var(--text-primary); min-height: 100vh; transition: all 0.3s ease; }
    .navbar-custom { background: var(--bg-card); border-bottom: 1px solid var(--border-color); padding: 16px 28px; }
    .card-dark { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 24px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); }
    
    input:-webkit-autofill,
    input:-webkit-autofill:hover, 
    input:-webkit-autofill:focus {
      -webkit-text-fill-color: var(--text-primary) !important;
      -webkit-box-shadow: 0 0 0px 1000px var(--bg-input) inset !important;
      transition: background-color 5000s ease-in-out 0s;
    }

    label.form-label {
      color: var(--text-secondary) !important;
      font-weight: 600 !important;
      font-size: 0.88rem !important;
      margin-bottom: 6px !important;
    }

    .form-control-dark {
      background-color: var(--bg-input) !important;
      border: 1px solid var(--border-color) !important;
      color: var(--text-primary) !important;
      border-radius: 12px !important;
      padding: 12px 16px !important;
    }

    .form-control-dark::placeholder {
      color: var(--text-muted) !important;
      opacity: 0.8 !important;
    }

    .form-control-dark:focus {
      border-color: #38bdf8 !important;
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2) !important;
    }

    .modal-content-dark {
      background-color: var(--bg-card) !important;
      border: 1px solid var(--border-color) !important;
      border-radius: 24px !important;
      color: var(--text-primary) !important;
    }

    .telegram-box {
      background: rgba(56, 189, 248, 0.05);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 18px;
      padding: 18px;
    }

    .table-custom {
      color: var(--text-primary) !important;
    }

    .table-custom th {
      background-color: var(--bg-card-header) !important;
      color: var(--text-secondary) !important;
      font-weight: 700 !important;
      padding: 16px 20px !important;
      border-bottom: 1px solid var(--border-color) !important;
    }

    .table-custom td {
      padding: 16px 20px !important;
      border-bottom: 1px solid var(--border-color) !important;
      vertical-align: middle !important;
    }
  </style>
</head>
<body>

  <!-- 1. راه‌اندازی اولیه -->
  <div id="setupView" class="min-vh-100 d-flex align-items-center justify-content-center p-3 d-none">
    <div class="card-dark text-center" style="max-width: 420px; width: 100%;">
      <div class="bg-primary text-white rounded-4 p-3 d-inline-flex mb-3" style="width:60px; height:60px; align-items:center; justify-content:center;">
        <i class="fa-solid fa-bolt fs-2"></i>
      </div>
      <h4 class="fw-bold mb-1 text-white">راه‌اندازی اولیه پنل دیزاینو</h4>
      <p class="text-muted small mb-4">تعیین نام کاربری و کلمه عبور ادمین برای Cloudflare Workers</p>
      <form id="setupForm">
        <div class="text-start mb-3">
          <label class="form-label">نام کاربری ادمین</label>
          <input type="text" id="setupUsername" class="form-control form-control-dark" placeholder="مثال: admin" required>
        </div>
        <div class="text-start mb-4">
          <label class="form-label">کلمه عبور ادمین</label>
          <input type="password" id="setupPassword" class="form-control form-control-dark" placeholder="••••••••" required>
        </div>
        <button type="submit" class="btn btn-primary w-100 py-3 rounded-3 fw-bold fs-6">ثبت و ورود به پنل</button>
      </form>
    </div>
  </div>

  <!-- 2. ورود ادمین -->
  <div id="loginView" class="min-vh-100 d-flex align-items-center justify-content-center p-3 d-none">
    <div class="card-dark text-center" style="max-width: 420px; width: 100%;">
      <div class="rounded-4 p-3 d-inline-flex mb-3" style="width:60px; height:60px; background:#6366f1; color:white; align-items:center; justify-content:center;">
        <i class="fa-solid fa-lock fs-2"></i>
      </div>
      <h4 class="fw-bold mb-1 text-white">ورود به پنل دیزاینو</h4>
      <p class="text-muted small mb-4">نسخه اختصاصی Cloudflare Workers</p>
      <form id="loginForm">
        <div class="text-start mb-3">
          <label class="form-label">نام کاربری</label>
          <input type="text" id="loginUsername" class="form-control form-control-dark" placeholder="نام کاربری" required>
        </div>
        <div class="text-start mb-4">
          <label class="form-label">کلمه عبور</label>
          <input type="password" id="loginPassword" class="form-control form-control-dark" placeholder="••••••••" required>
        </div>
        <button type="submit" class="btn btn-primary w-100 py-3 rounded-3 fw-bold fs-6">ورود به سیستم</button>
      </form>
    </div>
  </div>

  <!-- 3. داشبورد اصلی -->
  <div id="dashView" class="d-none">
    <nav class="navbar-custom d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
      <div class="d-flex align-items-center gap-3">
        <div class="bg-primary text-white rounded-3 p-2 d-flex align-items-center justify-content-center" style="width:40px; height:40px;">
          <i class="fa-solid fa-bolt"></i>
        </div>
        <div>
          <h5 class="fw-bold mb-0">پنل دیزاینو وی پی ان</h5>
          <span class="small text-muted">نسخه کلودفلر (Cloudflare Workers)</span>
        </div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <button class="btn btn-sm btn-outline-warning rounded-3" onclick="toggleTheme()" title="تغییر تم (تیره / روشن)">
          <i class="fa-solid fa-sun" id="themeIcon"></i>
        </button>
        <button class="btn btn-sm btn-outline-info rounded-3" data-bs-toggle="modal" data-bs-target="#cleanIpModal">
          <i class="fa-solid fa-network-wired me-1"></i> آی‌پی تمیز
        </button>
        <button class="btn btn-sm btn-outline-light rounded-3" data-bs-toggle="modal" data-bs-target="#settingsModal" title="تنظیمات سیستم">
          <i class="fa-solid fa-gear"></i> تنظیمات
        </button>
        <button class="btn btn-sm btn-outline-danger rounded-3" onclick="location.reload()">
          <i class="fa-solid fa-power-off"></i>
        </button>
      </div>
    </nav>

    <div class="container-fluid px-3 px-md-5">
      <div id="kvWarning" class="alert alert-warning rounded-4 mb-4 d-none">
        <i class="fa-solid fa-triangle-exclamation me-2"></i> <strong>هشدار دیتابیس KV:</strong> دیتابیس 'DIZYNO_KV' متصل نشده است. برای ذخیره دائمی کاربران در کلودفلر، به زبانه Settings -> Variables & Bindings بروید و یک KV Binding به نام 'DIZYNO_KV' بسازید.
      </div>

      <div class="card-dark mb-4">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-4">
          <h5 class="fw-bold mb-0"><i class="fa-solid fa-users text-primary me-2"></i> لیست کاربران</h5>
          <button class="btn btn-primary rounded-3 px-4 py-2.5 fw-bold" data-bs-toggle="modal" data-bs-target="#createUserModal">
            <i class="fa-solid fa-user-plus me-2"></i> ساخت کاربر جدید
          </button>
        </div>

        <div class="table-responsive">
          <table class="table table-custom table-hover align-middle mb-0">
            <thead>
              <tr>
                <th>#</th>
                <th>نام کاربر</th>
                <th>حجم مصرفی (زنده)</th>
                <th>اعتبار (روز باقی‌مانده)</th>
                <th>وضعیت</th>
                <th class="text-center">عملیات</th>
              </tr>
            </thead>
            <tbody id="userTable"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- مودال ساخت کاربر جدید -->
  <div class="modal fade" id="createUserModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content modal-content-dark">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title fw-bold"><i class="fa-solid fa-user-plus text-primary me-2"></i> ساخت کاربر جدید</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <form id="createUserForm">
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">نام کاربر</label>
              <input type="text" id="newUserName" class="form-control form-control-dark" placeholder="مثال: ali_user" required>
            </div>
            <div class="mb-3">
              <label class="form-label">حجم مجاز (گیگابایت - GB)</label>
              <input type="number" id="newUserLimitGB" class="form-control form-control-dark" placeholder="مثال: 50 (0 یعنی نامحدود)" value="50">
            </div>
            <div class="mb-3">
              <label class="form-label">مدت زمان اعتبار (روز)</label>
              <input type="number" id="newUserExpireDays" class="form-control form-control-dark" placeholder="مثال: 30 (0 یعنی نامحدود)" value="30">
            </div>
          </div>
          <div class="modal-footer border-secondary border-opacity-25">
            <button type="button" class="btn btn-outline-secondary rounded-3" data-bs-dismiss="modal">انصراف</button>
            <button type="submit" class="btn btn-primary rounded-3 px-4 fw-bold">ایجاد کاربر</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- مودال تنظیمات کامل سیستم همراه با کادر اختصاصی ربات تلگرام -->
  <div class="modal fade" id="settingsModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content modal-content-dark">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title fw-bold"><i class="fa-solid fa-gear text-warning me-2"></i> تنظیمات کامل سیستم و ربات</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <form id="settingsForm">
          <div class="modal-body p-4">
            <h6 class="fw-bold text-white mb-3"><i class="fa-solid fa-shield-halved text-primary me-2"></i> اطلاعات ادمین و شبکه</h6>
            <div class="row g-3 mb-4">
              <div class="col-md-6">
                <label class="form-label">نام کاربری ادمین</label>
                <input type="text" id="settingsUsername" class="form-control form-control-dark" required>
              </div>
              <div class="col-md-6">
                <label class="form-label">کلمه عبور ادمین</label>
                <input type="password" id="settingsPassword" class="form-control form-control-dark" placeholder="رمز جدید یا قبلی" required>
              </div>
              <div class="col-12">
                <label class="form-label">آی‌پی یا دامنه تمیز اتصال</label>
                <input type="text" id="settingsCleanIp" class="form-control form-control-dark" placeholder="مثال: 162.159.192.1">
              </div>
            </div>

            <!-- کادر شیک و برجسته اختصاصی تنظیمات ربات تلگرام -->
            <div class="telegram-box">
              <div class="d-flex align-items-center justify-content-between mb-3">
                <h6 class="fw-bold text-info mb-0 d-flex align-items-center gap-2">
                  <i class="fa-brands fa-telegram fs-4"></i> مدیریت و ربات تعاملی تلگرام
                </h6>
                <span class="badge bg-info text-dark rounded-pill px-3 py-1 fw-bold">نسخه هوشمند</span>
              </div>
              <p class="text-muted small mb-3">با ثبت توکن و اتصال وب‌هوک، ربات تلگرام فوراً پیام‌های /start و منوی مدیریت سرور را فعال می‌کند.</p>

              <div class="mb-3">
                <label class="form-label">توکن ربات (BotFather Token)</label>
                <div class="input-group">
                  <input type="text" id="settingsBotToken" class="form-control form-control-dark" placeholder="مثال: 123456789:ABCdefGHI...">
                  <button type="button" class="btn btn-info text-white px-3 fw-bold" onclick="triggerSetWebhook()">
                    ⚡ اتصال و ثبت وب‌هوک
                  </button>
                </div>
              </div>

              <div>
                <label class="form-label">Chat ID عددی ادمین در تلگرام</label>
                <input type="text" id="settingsAdminId" class="form-control form-control-dark" placeholder="مثال: 8650344689">
              </div>
            </div>
          </div>
          <div class="modal-footer border-secondary border-opacity-25">
            <button type="button" class="btn btn-outline-secondary rounded-3" data-bs-dismiss="modal">انصراف</button>
            <button type="submit" class="btn btn-primary rounded-3 px-4 fw-bold">ذخیره تمام تنظیمات</button>
          </div>
        </form>
      </div>
    </div>
  </div>

  <!-- مودال اسکنر آی‌پی تمیز -->
  <div class="modal fade" id="cleanIpModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content modal-content-dark">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title fw-bold"><i class="fa-solid fa-network-wired text-info me-2"></i> تنظیم آی‌پی تمیز</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label class="form-label">آی‌پی یا دامنه تمیز اختصاصی</label>
            <input type="text" id="cleanIpInput" class="form-control form-control-dark" placeholder="مثال: 162.159.192.1">
          </div>
          <button class="btn btn-info w-100 rounded-3 py-2 fw-bold text-white mb-3" onclick="saveCleanIp()">ذخیره و اعمال روی کانفیگ‌ها</button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script>
    async function init() {
      const res = await fetch('/api/setup-status');
      const data = await res.json();
      if (!data.kvBound) {
        document.getElementById('kvWarning')?.classList.remove('d-none');
      }
      if (!data.isConfigured) {
        document.getElementById('setupView').classList.remove('d-none');
      } else {
        document.getElementById('loginView').classList.remove('d-none');
      }
    }

    document.getElementById('setupForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/setup-initial', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          username: document.getElementById('setupUsername').value,
          password: document.getElementById('setupPassword').value
        })
      });
      const data = await res.json();
      if (data.success) showDash();
    });

    document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          username: document.getElementById('loginUsername').value,
          password: document.getElementById('loginPassword').value
        })
      });
      const data = await res.json();
      if (data.success) showDash();
      else alert(data.message);
    });

    document.getElementById('createUserForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('newUserName').value;
      const limitGB = document.getElementById('newUserLimitGB').value;
      const expireDays = document.getElementById('newUserExpireDays').value;

      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, limitGB, expireDays })
      });
      const data = await res.json();
      if (data.success) {
        bootstrap.Modal.getInstance(document.getElementById('createUserModal')).hide();
        document.getElementById('newUserName').value = '';
        loadUsers();
      } else {
        alert(data.message);
      }
    });

    document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('settingsUsername').value;
      const password = document.getElementById('settingsPassword').value;
      const cleanIp = document.getElementById('settingsCleanIp').value;
      const telegramBotToken = document.getElementById('settingsBotToken').value;
      const telegramAdminId = document.getElementById('settingsAdminId').value;

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, password, cleanIp, telegramBotToken, telegramAdminId })
      });
      const data = await res.json();
      if (data.success) {
        alert('تنظیمات ذخیره شد.');
        bootstrap.Modal.getInstance(document.getElementById('settingsModal')).hide();
      }
    });

    async function triggerSetWebhook() {
      const token = document.getElementById('settingsBotToken').value.trim();
      const adminId = document.getElementById('settingsAdminId').value.trim();

      if (!token) {
        alert('لطفاً توکن ربات تلگرام را در کادر مربوطه وارد کنید.');
        return;
      }

      const res = await fetch('/api/set-telegram-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, adminId })
      });
      const data = await res.json();
      alert(data.message);
    }

    async function showDash() {
      document.getElementById('setupView').classList.add('d-none');
      document.getElementById('loginView').classList.add('d-none');
      document.getElementById('dashView').classList.remove('d-none');
      loadSettings();
      loadUsers();
    }

    async function loadSettings() {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.settings) {
        document.getElementById('settingsUsername').value = data.settings.username || '';
        document.getElementById('settingsPassword').value = data.settings.password || '';
        document.getElementById('settingsCleanIp').value = data.settings.cleanIp || '';
        document.getElementById('settingsBotToken').value = data.settings.telegramBotToken || '';
        document.getElementById('settingsAdminId').value = data.settings.telegramAdminId || '';
        document.getElementById('cleanIpInput').value = data.settings.cleanIp || '';
      }
    }

    async function loadUsers() {
      const res = await fetch('/api/users');
      const data = await res.json();
      const tbody = document.getElementById('userTable');
      tbody.innerHTML = '';
      if (!data.users || data.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">هیچ کاربری یافت نشد. دکمه ساخت کاربر جدید را بزنید.</td></tr>';
        return;
      }

      data.users.forEach((u, i) => {
        const subUrl = location.origin + '/sub/' + u.uuid;
        const htmlSubUrl = subUrl + '?html=true';
        const usedGB = (u.usedBytes/(1024*1024*1024)).toFixed(2);
        const limitGB = u.limitBytes > 0 ? (u.limitBytes/(1024*1024*1024)).toFixed(2) + ' GB' : 'نامحدود';

        let expireText = 'نامحدود';
        if (u.expireDate) {
          const diffDays = Math.ceil((new Date(u.expireDate) - new Date()) / (1024 * 60 * 60 * 24));
          expireText = diffDays > 0 ? diffDays + ' روز باقی‌مانده' : 'منقضی شده';
        }

        let percent = 0;
        if (u.limitBytes > 0) {
          percent = Math.min(100, Math.round((u.usedBytes / u.limitBytes) * 100));
        }

        tbody.innerHTML += \`
          <tr>
            <td>\${i+1}</td>
            <td><strong>\${u.name}</strong></td>
            <td>
              <div><strong class="text-info">\${usedGB} GB</strong> / <span class="text-muted">\${limitGB}</span></div>
              \${u.limitBytes > 0 ? \`<div class="progress mt-1" style="height: 6px;"><div class="progress-bar bg-info" style="width: \${percent}%"></div></div>\` : ''}
            </td>
            <td><strong class="\${expireText === 'منقضی شده' ? 'text-danger' : 'text-warning'}">\${expireText}</strong></td>
            <td><span class="badge \${expireText === 'منقضی شده' ? 'bg-danger' : 'bg-success'} rounded-pill px-3 py-1.5">\${expireText === 'منقضی شده' ? 'منقضی' : 'فعال'}</span></td>
            <td class="text-center">
              <button class="btn btn-sm btn-outline-primary me-1 rounded-3" onclick="copyText('\${subUrl}', 'لینک ساب کپی شد!')" title="کپی لینک سابسکریپشن"><i class="fa-solid fa-link"></i> کپی ساب</button>
              <button class="btn btn-sm btn-outline-info me-1 rounded-3" onclick="window.open('\${htmlSubUrl}', '_blank')" title="مشاهده صفحه ساب"><i class="fa-solid fa-qrcode"></i> صفحه ساب</button>
              <button class="btn btn-sm btn-outline-danger rounded-3" onclick="deleteUser('\${u.id}')" title="حذف کاربر"><i class="fa-solid fa-trash"></i></button>
            </td>
          </tr>
        \`;
      });
    }

    function copyText(text, msg) {
      navigator.clipboard.writeText(text).then(() => alert(msg)).catch(() => alert('امکان کپی وجود ندارد.'));
    }

    async function deleteUser(id) {
      if (!confirm('آیا از حذف این کاربر اطمینان دارید؟')) return;
      await fetch('/api/users/' + id, { method: 'DELETE' });
      loadUsers();
    }

    async function saveCleanIp() {
      const cleanIp = document.getElementById('cleanIpInput').value;
      await fetch('/api/settings', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ cleanIp })
      });
      alert('آی‌پی تمیز ذخیره شد.');
      bootstrap.Modal.getInstance(document.getElementById('cleanIpModal')).hide();
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      document.getElementById('themeIcon').className = next === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }

    init();
  </script>
</body>
</html>`;
}
