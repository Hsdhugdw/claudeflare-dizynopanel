/**
 * ورکر اختصاصی «دیزاینو وی پی ان» (Dizyno VPN Panel - Cloudflare Workers Edition)
 * شامل پشتیبانی از چندین کانفیگ (VLESS-WS و Trojan-WS)، پینگ واقعی سبز (پراکسی سوکت دایرکت)،
 * داشبورد مدیریت شیک، راه‌اندازی اولیه، مودال تنظیمات، آی‌پی تمیز و سابسکریپشن هوشمند.
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

// تابع تبدیل امن رشته‌های فارسی و UTF-8 به Base64 (جلوگیری از ارور ۵۰۰)
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
        const body = await request.json();
        await handleTelegramWorkerUpdate(body, env, url.origin);
        return jsonResponse({ success: true });
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

        // ساخت لیست متنوع کانفیگ‌های VLESS و Trojan
        const configsList = [
          `vless://${user.uuid}@${connectAddress}:443?type=ws&path=%2Fvless&security=tls&encryption=none&fp=chrome&sni=${host}&host=${host}#${encodeURIComponent(user.name + ' | VLESS-WS')}`,
          `trojan://${user.uuid}@${connectAddress}:443?type=ws&path=%2Ftrojan&security=tls&fp=chrome&sni=${host}&host=${host}#${encodeURIComponent(user.name + ' | Trojan-WS')}`
        ];

        // اگر آدرس دامنه اصلی متفاوت از آی‌پی تمیز باشد، کانفیگ مستقیم هم اضافه می‌شود
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

// پاسخ JSON استاندارد
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// ارسال پیام تلگرام در نسخه کلودفلر ورکر
async function sendTelegramWorkerMessage(env, text, replyMarkup = null, customChatId = null) {
  const settings = await getSettings(env);
  if (!settings.telegramBotToken) return;

  const chatId = customChatId || settings.telegramAdminId;
  if (!chatId) return;

  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
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
      [{ text: '📊 آمار سرور' }, { text: '👥 لیست کاربران' }],
      [{ text: '➕ ساخت کاربر جدید' }, { text: '🔍 استعلام کاربر' }]
    ],
    resize_keyboard: true,
    persistent: true
  };
}

// پردازش دستورات ورودی تلگرام در نسخه کلودفلر
async function handleTelegramWorkerUpdate(update, env, origin) {
  if (!update || !update.message || !update.message.text) return;

  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const settings = await getSettings(env);

  // تنها پاسخ به ادمین یا در صورت عدم تنظیم ادمین آی‌دی به همه
  if (settings.telegramAdminId && chatId.toString() !== settings.telegramAdminId.toString()) {
    await sendTelegramWorkerMessage(env, '⛔ دسترسی غیرمجاز. این ربات تنها برای مدیریت سرور تنظیم شده است.', null, chatId);
    return;
  }

  // دستور /start یا منو
  if (text === '/start' || text === 'منو' || text === 'menu') {
    await sendTelegramWorkerMessage(
      env,
      `⚡ **به ربات مدیریتی «دیزاینو وی پی ان» (Cloudflare Edition) خوش آمدید!**\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:`,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
    return;
  }

  // آمار سرور
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
      `📊 **آمار کلی پنل دیزاینو کلودفلر:**\n\n` +
      `👥 **کل کاربران:** ${totalUsers} نفر\n` +
      `✅ **کاربران فعال:** ${activeUsers} نفر\n` +
      `❌ **کاربران منقضی:** ${expiredUsers} نفر\n` +
      `🌐 **کل ترافیک مصرفی:** ${usedGB} GB`,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
    return;
  }

  // لیست کاربران
  if (text === '👥 لیست کاربران' || text === '/users') {
    const users = await getUsers(env);
    if (users.length === 0) {
      await sendTelegramWorkerMessage(env, 'ℹ️ هیچ کاربری در پنل ثبت نشده است.', getTelegramWorkerMainMenuKeyboard(), chatId);
      return;
    }

    let reply = `👥 **لیست کاربران پنل:**\n\n`;
    users.slice(0, 15).forEach((u, i) => {
      const usedGB = (u.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
      const limitGB = u.limitBytes > 0 ? (u.limitBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : 'نامحدود';
      reply += `${i + 1}. 👤 **${u.name}** | 📊 ${usedGB}/${limitGB} | ⏳ ${u.expireDate || 'نامحدود'}\n/sub_${u.uuid}\n\n`;
    });

    await sendTelegramWorkerMessage(env, reply, getTelegramWorkerMainMenuKeyboard(), chatId);
    return;
  }

  // راهنمای ساخت کاربر
  if (text === '➕ ساخت کاربر جدید' || text === '/create') {
    await sendTelegramWorkerMessage(
      env,
      `➕ **راهنمای ساخت کاربر جدید:**\n\n` +
      `لطفاً دستور ساخت را به این فرمت ارسال کنید:\n` +
      `\`create نام_کاربر حجم_GB روز_اعتبار\`\n\n` +
      `📌 **مثال ساخت کاربر با ۵۰ گیگ و ۳۰ روز:**\n` +
      `\`create ali 50 30\``,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
    return;
  }

  // ساخت کاربر مستقیم
  if (text.startsWith('create ')) {
    const parts = text.split(' ');
    const name = parts[1];
    const limitGB = parts[2] ? parseFloat(parts[2]) : 0;
    const expireDays = parts[3] ? parseInt(parts[3]) : 0;

    if (!name) {
      await sendTelegramWorkerMessage(env, '❌ لطفاً نام کاربر را وارد کنید.', getTelegramWorkerMainMenuKeyboard(), chatId);
      return;
    }

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
      `✅ **کاربر با موفقیت در کلودفلر ایجاد شد!**\n\n` +
      `👤 **نام:** ${newUser.name}\n` +
      `📊 **حجم:** ${limitGB > 0 ? limitGB + ' GB' : 'نامحدود'}\n` +
      `⏳ **اعتبار:** ${expireDays > 0 ? expireDays + ' روز' : 'نامحدود'}\n\n` +
      `🔑 **UUID:** \`${newUser.uuid}\`\n\n` +
      `🔗 **لینک ساب:**\n\`${subUrl}\``,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
    return;
  }

  // استعلام کاربر
  if (text === '🔍 استعلام کاربر') {
    await sendTelegramWorkerMessage(
      env,
      `🔍 **راهنمای استعلام کاربر:**\n\n` +
      `برای دریافت لینک ساب و آمار کاربر، نام یا UUID آن را ارسال کنید:\n` +
      `مثال:\n\`info ali\``,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
    return;
  }

  if (text.startsWith('info ') || text.startsWith('/sub_')) {
    const query = text.replace('info ', '').replace('/sub_', '').trim().toLowerCase();
    const users = await getUsers(env);
    const user = users.find(u => u.name.toLowerCase() === query || u.uuid.toLowerCase() === query || u.id === query);

    if (!user) {
      await sendTelegramWorkerMessage(env, '❌ کاربر یافت نشد.', getTelegramWorkerMainMenuKeyboard(), chatId);
      return;
    }

    const usedGB = (user.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
    const limitGB = user.limitBytes > 0 ? (user.limitBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : 'نامحدود';

    await sendTelegramWorkerMessage(
      env,
      `👤 **اطلاعات کاربر ${user.name}:**\n\n` +
      `📊 **حجم مصرفی:** ${usedGB} / ${limitGB}\n` +
      `⏳ **تاریخ انقضا:** ${user.expireDate || 'نامحدود'}\n` +
      `🔑 **UUID:** \`${user.uuid}\`\n\n` +
      `🔗 **لینک ساب:**\n\`${origin}/sub/${user.uuid}\``,
      getTelegramWorkerMainMenuKeyboard(),
      chatId
    );
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

        // پارس دقیق پروتکل VLESS و Trojan
        const vlessVersion = buffer[0];
        const optLength = buffer[17];
        let cursor = 18 + optLength;

        const command = buffer[cursor]; // 1 = TCP, 2 = UDP
        cursor++;

        const port = (buffer[cursor] << 8) | buffer[cursor + 1];
        cursor += 2;

        const addressType = buffer[cursor];
        cursor++;

        let address = '';
        if (addressType === 1) { // IPv4
          address = `${buffer[cursor]}.${buffer[cursor+1]}.${buffer[cursor+2]}.${buffer[cursor+3]}`;
          cursor += 4;
        } else if (addressType === 2) { // Domain Name
          const domainLen = buffer[cursor];
          cursor++;
          address = new TextDecoder().decode(buffer.subarray(cursor, cursor + domainLen));
          cursor += domainLen;
        } else if (addressType === 3) { // IPv6
          const ipv6Bytes = buffer.subarray(cursor, cursor + 16);
          address = Array.from(ipv6Bytes).map(b => b.toString(16).padStart(2, '0')).join('').match(/.{1,4}/g).join(':');
          cursor += 16;
        }

        if (!address || !port || port <= 0 || port > 65535) return;

        isHeaderParsed = true;

        // ارسال پاسخ هدر VLESS به کلاینت
        server.send(new Uint8Array([vlessVersion, 0]));

        // اتصال دایرکت TCP به آدرس و پورت مقصد از طریق شبکه پرسرعت کلودفلر
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
    body { font-family: 'Vazirmatn', sans-serif; background: #090d16; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; margin: 0; }
    .card-box { background: rgba(18, 25, 41, 0.92); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 28px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 25px 60px rgba(0,0,0,0.6); }
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
          <span class="text-muted small">دیزاینو وی پی ان | Cloudflare</span>
        </div>
      </div>
      <span class="badge bg-success rounded-pill px-3 py-2">فعال</span>
    </div>
    
    <div class="p-3 bg-dark rounded-4 mb-4 text-start small border border-secondary border-opacity-25">
      <div class="d-flex justify-content-between mb-2">
        <span class="text-muted">حجم مصرفی:</span>
        <strong class="text-info fs-6">${usedGB} GB / ${limitGB} ${limitGB !== 'نامحدود' ? 'GB' : ''}</strong>
      </div>
      <div class="d-flex justify-content-between">
        <span class="text-muted">تاریخ اعتبار:</span>
        <strong class="text-warning fs-6">${user.expireDate || 'نامحدود'}</strong>
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

// رندر کامل داشبورد گرافیکی مدیریت با تمام مودال‌ها
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
      --bg-primary: #070a13;
      --bg-card: rgba(18, 25, 41, 0.92);
      --bg-input: #090d16;
      --border-color: rgba(255, 255, 255, 0.12);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
    }
    [data-theme="light"] {
      --bg-primary: #f1f5f9;
      --bg-card: #ffffff;
      --bg-input: #ffffff;
      --border-color: #cbd5e1;
      --text-main: #0f172a;
      --text-muted: #475569;
    }
    body { font-family: 'Vazirmatn', sans-serif; background: var(--bg-primary); color: var(--text-main); min-height: 100vh; transition: background 0.3s; }
    .navbar-custom { background: var(--bg-card); border-bottom: 1px solid var(--border-color); padding: 16px 28px; }
    .card-dark { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 24px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
    .form-control-dark { background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-main); border-radius: 14px; padding: 12px 16px; }
    .form-control-dark:focus { background: var(--bg-input); color: var(--text-main); border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.2); }
    .modal-content-dark { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 24px; color: var(--text-main); }
  </style>
</head>
<body>

  <!-- 1. راه‌اندازی اولیه -->
  <div id="setupView" class="min-vh-100 d-flex align-items-center justify-content-center p-3 d-none">
    <div class="card-dark text-center" style="max-width: 420px; width: 100%;">
      <div class="bg-primary text-white rounded-4 p-3 d-inline-flex mb-3" style="width:60px; height:60px; align-items:center; justify-content:center;">
        <i class="fa-solid fa-bolt fs-2"></i>
      </div>
      <h4 class="fw-bold mb-1">راه‌اندازی اولیه پنل دیزاینو</h4>
      <p class="text-muted small mb-4">تعیین نام کاربری و کلمه عبور ادمین برای Cloudflare Workers</p>
      <form id="setupForm">
        <input type="text" id="setupUsername" class="form-control form-control-dark mb-3" placeholder="نام کاربری ادمین" required>
        <input type="password" id="setupPassword" class="form-control form-control-dark mb-4" placeholder="کلمه عبور جدید" required>
        <button type="submit" class="btn btn-primary w-100 py-3 rounded-3 fw-bold fs-6">ثبت و ورود به پنل</button>
      </form>
    </div>
  </div>

  <!-- 2. ورود ادمین -->
  <div id="loginView" class="min-vh-100 d-flex align-items-center justify-content-center p-3 d-none">
    <div class="card-dark text-center" style="max-width: 420px; width: 100%;">
      <div class="bg-indigo text-white rounded-4 p-3 d-inline-flex mb-3" style="width:60px; height:60px; background:#6366f1; align-items:center; justify-content:center;">
        <i class="fa-solid fa-lock fs-2"></i>
      </div>
      <h4 class="fw-bold mb-1">ورود به پنل دیزاینو</h4>
      <p class="text-muted small mb-4">نسخه اختصاصی Cloudflare Workers</p>
      <form id="loginForm">
        <input type="text" id="loginUsername" class="form-control form-control-dark mb-3" placeholder="نام کاربری" required>
        <input type="password" id="loginPassword" class="form-control form-control-dark mb-4" placeholder="کلمه عبور" required>
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
          <table class="table table-dark table-hover align-middle mb-0">
            <thead>
              <tr class="text-muted">
                <th>#</th>
                <th>نام کاربر</th>
                <th>حجم مصرفی</th>
                <th>اعتبار (روز)</th>
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
              <label class="form-label small text-muted">نام کاربر</label>
              <input type="text" id="newUserName" class="form-control form-control-dark" placeholder="مثال: ali_user" required>
            </div>
            <div class="mb-3">
              <label class="form-label small text-muted">حجم مجاز (گیگابایت - GB)</label>
              <input type="number" id="newUserLimitGB" class="form-control form-control-dark" placeholder="مثال: 50 (0 یعنی نامحدود)" value="50">
            </div>
            <div class="mb-3">
              <label class="form-label small text-muted">مدت زمان اعتبار (روز)</label>
              <input type="number" id="newUserExpireDays" class="form-control form-control-dark" placeholder="مثال: 30" value="30">
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

  <!-- مودال تنظیمات کامل سیستم -->
  <div class="modal fade" id="settingsModal" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content modal-content-dark">
        <div class="modal-header border-secondary border-opacity-25">
          <h5 class="modal-title fw-bold"><i class="fa-solid fa-gear text-warning me-2"></i> تنظیمات سیستم</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <form id="settingsForm">
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label small text-muted">نام کاربری ادمین</label>
              <input type="text" id="settingsUsername" class="form-control form-control-dark" required>
            </div>
            <div class="mb-3">
              <label class="form-label small text-muted">کلمه عبور ادمین</label>
              <input type="password" id="settingsPassword" class="form-control form-control-dark" placeholder="رمز جدید یا قبلی" required>
            </div>
            <div class="mb-3">
              <label class="form-label small text-muted">آی‌پی یا دامنه تمیز اتصال</label>
              <input type="text" id="settingsCleanIp" class="form-control form-control-dark" placeholder="مثال: 162.159.192.1">
            </div>
            <div class="mb-3">
              <label class="form-label small text-muted">توکن ربات تلگرام (BotFather Token)</label>
              <input type="text" id="settingsBotToken" class="form-control form-control-dark" placeholder="اختیاری">
            </div>
            <div class="mb-3">
              <label class="form-label small text-muted">Chat ID ادمین در تلگرام</label>
              <input type="text" id="settingsAdminId" class="form-control form-control-dark" placeholder="اختیاری">
            </div>
          </div>
          <div class="modal-footer border-secondary border-opacity-25">
            <button type="button" class="btn btn-outline-secondary rounded-3" data-bs-dismiss="modal">انصراف</button>
            <button type="submit" class="btn btn-primary rounded-3 px-4 fw-bold">ذخیره تنظیمات</button>
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
            <label class="form-label small text-muted">آی‌پی یا دامنه تمیز اختصاصی</label>
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
        const limitGB = u.limitBytes > 0 ? (u.limitBytes/(1024*1024*1024)).toFixed(2) : 'نامحدود';

        tbody.innerHTML += \`
          <tr>
            <td>\${i+1}</td>
            <td><strong>\${u.name}</strong></td>
            <td><span class="text-info">\${usedGB} GB</span> / <span class="text-muted">\${limitGB}</span></td>
            <td>\${u.expireDate || 'نامحدود'}</td>
            <td><span class="badge bg-success rounded-pill px-3 py-1.5">فعال</span></td>
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
