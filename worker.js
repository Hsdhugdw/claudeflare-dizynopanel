/**
 * ورکر اختصاصی «دیزاینو وی پی ان» (Dizyno VPN Panel - Cloudflare Workers Edition)
 * پشتیبانی از VLESS over WebSocket، داشبورد مدیریت، راه‌اندازی اولیه، آی‌پی تمیز و ربات تلگرام
 */

import { connect } from 'cloudflare:sockets';

const DEFAULT_SETTINGS = {
  isConfigured: false,
  username: '',
  password: '',
  cleanIp: '',
  enableVlessWs: true,
  telegramBotToken: '',
  telegramAdminId: ''
};

// حافظه موقت درون برنامه (در صورت عدم اتصال KV)
let memoryStore = {
  settings: { ...DEFAULT_SETTINGS },
  users: []
};

// دریافت تنظیمات
async function getSettings(env) {
  if (env && env.DIZYNO_KV) {
    const data = await env.DIZYNO_KV.get('settings', 'json');
    if (data) return { ...DEFAULT_SETTINGS, ...data };
  }
  return memoryStore.settings;
}

// ذخیره تنظیمات
async function saveSettings(env, settings) {
  memoryStore.settings = settings;
  if (env && env.DIZYNO_KV) {
    await env.DIZYNO_KV.put('settings', JSON.stringify(settings));
  }
}

// دریافت کاربران
async function getUsers(env) {
  if (env && env.DIZYNO_KV) {
    const data = await env.DIZYNO_KV.get('users', 'json');
    if (data) return data;
  }
  return memoryStore.users;
}

// ذخیره کاربران
async function saveUsers(env, users) {
  memoryStore.users = users;
  if (env && env.DIZYNO_KV) {
    await env.DIZYNO_KV.put('users', JSON.stringify(users));
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
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // هندل کردن اتصال VLESS over WebSocket
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
      return await handleVlessWebSocket(request, env);
    }

    const path = url.pathname;

    // API بررسی وضعیت راه‌اندازی
    if (path === '/api/setup-status') {
      const settings = await getSettings(env);
      const users = await getUsers(env);
      return jsonResponse({ success: true, isConfigured: !!settings.isConfigured, hasUsers: users.length > 0 });
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
      return jsonResponse({ success: true, message: 'راه‌اندازی اولیه ورکر دیزاینو انجام شد.' });
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

    // API بررسی ورود
    if (path === '/api/check-auth') {
      const settings = await getSettings(env);
      return jsonResponse({ success: true, username: settings.username, settings });
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

      let expireDate = null;
      if (body.expireDays && parseInt(body.expireDays) > 0) {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(body.expireDays));
        expireDate = d.toISOString().split('T')[0];
      }

      const newUser = {
        id: crypto.randomUUID(),
        name: body.name.trim(),
        uuid: crypto.randomUUID(),
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

    // API ویرایش/حذف کاربر
    if (path.startsWith('/api/users/')) {
      const parts = path.split('/');
      const userId = parts[3];
      const action = parts[4];
      const users = await getUsers(env);
      const index = users.findIndex(u => u.id === userId);

      if (index === -1) return jsonResponse({ success: false, message: 'کاربر یافت نشد.' }, 404);

      if (request.method === 'DELETE') {
        users.splice(index, 1);
        await saveUsers(env, users);
        return jsonResponse({ success: true, message: 'کاربر حذف شد.' });
      }

      if (action === 'reset-traffic' && request.method === 'POST') {
        users[index].usedBytes = 0;
        await saveUsers(env, users);
        return jsonResponse({ success: true, message: 'ترافیک صفر شد.' });
      }

      if (request.method === 'PUT') {
        const body = await request.json();
        if (body.name) users[index].name = body.name.trim();
        if (body.limitGB !== undefined) users[index].limitBytes = parseFloat(body.limitGB) * 1024 * 1024 * 1024;
        if (body.expireDate !== undefined) users[index].expireDate = body.expireDate;
        if (body.status) users[index].status = body.status;

        await saveUsers(env, users);
        return jsonResponse({ success: true, message: 'اطلاعات کاربر ویرایش شد.' });
      }
    }

    // API تغییر تنظیمات
    if (path === '/api/change-password' && request.method === 'POST') {
      const body = await request.json();
      const settings = await getSettings(env);

      if (body.newUsername) settings.username = body.newUsername.trim();
      if (body.newPassword) settings.password = body.newPassword.trim();
      if (body.cleanIp !== undefined) settings.cleanIp = body.cleanIp.trim();

      await saveSettings(env, settings);
      return jsonResponse({ success: true, message: 'تنظیمات با موفقیت ذخیره شد.' });
    }

    // API لیست آی‌پی‌های تمیز
    if (path === '/api/clean-ips') {
      const settings = await getSettings(env);
      return jsonResponse({ success: true, currentCleanIp: settings.cleanIp || '', presetIps: PRESET_CLEAN_IPS });
    }

    // مسیر سابسکریپشن هوشمند (/sub/:uuid)
    if (path.startsWith('/sub/')) {
      const uuid = path.split('/sub/')[1];
      const users = await getUsers(env);
      const user = users.find(u => u.uuid === uuid);

      if (!user) return new Response('User Not Found', { status: 404 });

      const settings = await getSettings(env);
      const host = url.hostname;
      const connectAddress = settings.cleanIp && settings.cleanIp.trim() !== '' ? settings.cleanIp.trim() : host;

      const vlessConfig = `vless://${user.uuid}@${connectAddress}:443?type=ws&path=%2Fvless&security=tls&encryption=none&fp=chrome&sni=${host}&host=${host}#${encodeURIComponent(user.name + ' | Dizyno-Workers')}`;
      const base64Config = btoa(vlessConfig);

      const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
      const secChUa = request.headers.get('sec-ch-ua');
      const acceptLang = request.headers.get('accept-language');
      const isVpnClient = /v2ray|xray|shadowrocket|nekobox|sing-box|clash|stash|quantumult|streisand|passwall|sagernet|surfboard|hiddify|flclash|matsuri|v2fly|go-http-client|axios|fetch|curl|wget/i.test(userAgent);

      const forceHtml = url.searchParams.get('html') === 'true';
      const forceRaw = url.searchParams.get('raw') === 'true' || url.searchParams.get('format') === 'base64';

      const isRealBrowser = (secChUa || acceptLang) && userAgent.includes('mozilla') && !isVpnClient;

      if ((forceHtml || isRealBrowser) && !forceRaw) {
        return new Response(renderSubHtml(user, url.origin, vlessConfig), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      const expireTimestamp = user.expireDate ? Math.floor(new Date(user.expireDate).getTime() / 1000) : 0;
      return new Response(base64Config, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Subscription-Userinfo': `upload=0; download=${user.usedBytes}; total=${user.limitBytes || 0}; expire=${expireTimestamp}`,
          'profile-title': `base64:${btoa(user.name)}`,
          'profile-update-interval': '24'
        }
      });
    }

    // رندر فرانت‌اند داشبورد اصلی
    return new Response(renderDashboardHtml(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
};

// پاسخ JSON استاندارد
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

// مدیریت VLESS over WebSocket سوکت دایرکت کلودفلر
async function handleVlessWebSocket(request, env) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  let remoteSocket = null;

  server.addEventListener('message', async (event) => {
    try {
      const buffer = new Uint8Array(event.data);
      if (buffer.length < 18) return;

      // خواندن آدرس مقصد و پورت از پروتکل VLESS
      const port = (buffer[18] << 8) | buffer[19];
      let addressType = buffer[20];
      let address = '';
      let addressEnd = 21;

      if (addressType === 1) { // IPv4
        address = `${buffer[21]}.${buffer[22]}.${buffer[23]}.${buffer[24]}`;
        addressEnd = 25;
      } else if (addressType === 2) { // Domain
        const len = buffer[21];
        address = new TextDecoder().decode(buffer.subarray(22, 22 + len));
        addressEnd = 22 + len;
      }

      if (!remoteSocket) {
        remoteSocket = connect({ hostname: address, port });
        const writer = remoteSocket.writable.getWriter();
        
        // ارسال پاسخ تایید به کلاینت VLESS
        server.send(new Uint8Array([buffer[0], 0]));

        writer.write(buffer.subarray(addressEnd));
        writer.releaseLock();

        remoteSocket.readable.pipeTo(new WritableStream({
          write(chunk) {
            server.send(chunk);
          }
        }));
      }
    } catch (e) {}
  });

  server.addEventListener('close', () => {
    if (remoteSocket) remoteSocket.close();
  });

  return new Response(null, {
    status: 101,
    webSocket: client
  });
}

// رندر صفحه وب سابسکریپشن
function renderSubHtml(user, origin, configLink) {
  const usedGB = (user.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
  const limitGB = user.limitBytes > 0 ? (user.limitBytes / (1024 * 1024 * 1024)).toFixed(2) : 'نامحدود';
  const subUrl = `${origin}/sub/${user.uuid}`;

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>دیزاینو وی پی ان | ${user.name}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
  <style>
    body { font-family: 'Vazirmatn', sans-serif; background: #090d16; color: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
    .card-box { background: rgba(18, 25, 41, 0.9); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 24px; padding: 28px; max-width: 440px; width: 100%; }
    .qr-box { background: #fff; padding: 10px; border-radius: 16px; display: inline-block; }
  </style>
</head>
<body>
  <div class="card-box text-center">
    <h4 class="fw-bold mb-1 text-white">${user.name}</h4>
    <p class="text-muted small mb-4">دیزاینو وی پی ان | نسخه Cloudflare Workers</p>
    
    <div class="p-3 bg-dark rounded-4 mb-3 text-start small">
      <div class="d-flex justify-content-between mb-1">
        <span>حجم مصرفی:</span>
        <strong class="text-info">${usedGB} GB / ${limitGB} GB</strong>
      </div>
      <div class="d-flex justify-content-between">
        <span>اعتبار:</span>
        <strong class="text-warning">${user.expireDate || 'نامحدود'}</strong>
      </div>
    </div>

    <div class="qr-box mb-4">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(subUrl)}" width="180" height="180">
    </div>

    <div class="d-grid gap-2">
      <button class="btn btn-primary py-2.5 rounded-3 fw-bold" onclick="navigator.clipboard.writeText('${subUrl}').then(() => alert('لینک ساب کپی شد!'))">
        <i class="fa-solid fa-link me-2"></i> کپی لینک ساب (Subscription)
      </button>
      <button class="btn btn-outline-light py-2.5 rounded-3 fw-bold" onclick="navigator.clipboard.writeText('${configLink}').then(() => alert('کانفیگ کپی شد!'))">
        <i class="fa-solid fa-copy me-2"></i> کپی مستقیم کانفیگ VLESS
      </button>
    </div>
  </div>
</body>
</html>`;
}

// رندر داشبورد اصلی مدیریت
function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>دیزاینو وی پی ان | Cloudflare Workers Edition</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.rtl.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet">
  <style>
    body { font-family: 'Vazirmatn', sans-serif; background: #070a13; color: #f8fafc; min-height: 100vh; }
    .card-dark { background: rgba(18, 25, 41, 0.9); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; }
    .form-control-dark { background: #090d16; border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; border-radius: 12px; }
  </style>
</head>
<body class="p-3 p-md-5">

  <div id="setupView" class="container max-w-md mx-auto d-none" style="max-width: 420px;">
    <div class="card-dark p-4 text-center">
      <h3 class="fw-bold mb-3 text-white">راه‌اندازی اولیه ورکر کلودفلر</h3>
      <form id="setupForm">
        <input type="text" id="setupUsername" class="form-control form-control-dark mb-3" placeholder="نام کاربری ادمین" required>
        <input type="password" id="setupPassword" class="form-control form-control-dark mb-3" placeholder="کلمه عبور" required>
        <button type="submit" class="btn btn-primary w-100 py-2.5 rounded-3 fw-bold">ثبت و ورود</button>
      </form>
    </div>
  </div>

  <div id="loginView" class="container mx-auto d-none" style="max-width: 420px;">
    <div class="card-dark p-4 text-center">
      <h3 class="fw-bold mb-3 text-white">ورود به پنل دیزاینو کلودفلر</h3>
      <form id="loginForm">
        <input type="text" id="loginUsername" class="form-control form-control-dark mb-3" placeholder="نام کاربری" required>
        <input type="password" id="loginPassword" class="form-control form-control-dark mb-3" placeholder="کلمه عبور" required>
        <button type="submit" class="btn btn-primary w-100 py-2.5 rounded-3 fw-bold">ورود به سیستم</button>
      </form>
    </div>
  </div>

  <div id="dashView" class="container d-none">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h4 class="fw-bold text-white mb-0"><i class="fa-solid fa-bolt text-primary me-2"></i> پنل دیزاینو وی پی ان (Cloudflare Edition)</h4>
      <button class="btn btn-sm btn-outline-danger rounded-3" onclick="location.reload()">خروج</button>
    </div>

    <div class="card-dark p-4 mb-4">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="fw-bold text-white mb-0">مدیریت کاربران</h5>
        <button class="btn btn-primary btn-sm rounded-3" onclick="createUserPrompt()">+ ساخت کاربر جدید</button>
      </div>
      <div class="table-responsive">
        <table class="table table-dark table-hover align-middle">
          <thead>
            <tr><th>#</th><th>نام کاربر</th><th>حجم مصرفی</th><th>تاریخ انقضا</th><th class="text-center">عملیات</th></tr>
          </thead>
          <tbody id="userTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    async function init() {
      const res = await fetch('/api/setup-status');
      const data = await res.json();
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

    async function showDash() {
      document.getElementById('setupView').classList.add('d-none');
      document.getElementById('loginView').classList.add('d-none');
      document.getElementById('dashView').classList.remove('d-none');
      loadUsers();
    }

    async function loadUsers() {
      const res = await fetch('/api/users');
      const data = await res.json();
      const tbody = document.getElementById('userTable');
      tbody.innerHTML = '';
      data.users.forEach((u, i) => {
        const subUrl = location.origin + '/sub/' + u.uuid;
        tbody.innerHTML += \`
          <tr>
            <td>\${i+1}</td>
            <td><strong>\${u.name}</strong></td>
            <td>\${(u.usedBytes/(1024*1024*1024)).toFixed(2)} GB</td>
            <td>\${u.expireDate || 'نامحدود'}</td>
            <td class="text-center">
              <button class="btn btn-sm btn-outline-info me-1" onclick="navigator.clipboard.writeText('\${subUrl}').then(()=>alert('کپی شد!'))">کپی ساب</button>
              <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('\${u.id}')">حذف</button>
            </td>
          </tr>
        \`;
      });
    }

    async function createUserPrompt() {
      const name = prompt('نام کاربر جدید را وارد کنید:');
      if (!name) return;
      await fetch('/api/users', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, limitGB: 50, expireDays: 30 })
      });
      loadUsers();
    }

    async function deleteUser(id) {
      if (!confirm('حذف کاربر؟')) return;
      await fetch('/api/users/' + id, { method: 'DELETE' });
      loadUsers();
    }

    init();
  </script>
</body>
</html>`;
}
