// ไฟล์ update.js (สคริปต์ติดตั้งอัตโนมัติ)
const fs = require('fs');
const path = require('path');

function runUpdate() {
    // อ่านโค้ด HTML จากคอมเมนต์ด้านล่างของไฟล์นี้
    const content = fs.readFileSync(__filename, 'utf-8');
    const htmlBlock = content.split('// ' + '--- HTML START ---')[1].split('// ' + '--- HTML END ---')[0].trim();
    
    // กำหนด Path ไปที่ universe/public/index.html
    const targetPath = path.join(__dirname, 'universe', 'public', 'index.html');
    
    // สร้างโฟลเดอร์และเขียนไฟล์ทับ
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, htmlBlock);
    
    console.log('\n================================================');
    console.log('✅ อัปเดตไฟล์เสร็จสมบูรณ์: ' + targetPath);
    console.log('================================================');
    console.log('🎉 ฟีเจอร์ที่ติดตั้งเรียบร้อยแล้ว:');
    console.log('  1. กด F5 หน้าเว็บแล้ว User ไม่หลุด (ใช้ localStorage)');
    console.log('  2. ปุ่ม Refresh กดย้ำๆ เพื่อโหลดข้อมูลใหม่ได้ทันที');
    console.log('  3. เพิ่มกราฟ Chart.js สรุปข้อมูลหน้า Dashboard');
    console.log('  4. เพิ่มหน้าต่าง Log สรุปประวัติการขอเบิก/ยืม ล่าสุด');
    console.log('------------------------------------------------');
    console.log('🚀 เสร็จสิ้น! สั่ง npm start แล้วใช้งานได้เลยครับ\n');
}

runUpdate();
process.exit(0);

/*
// --- HTML START ---
<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>HTC Universe</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body{font-family:'Kanit',system-ui,Segoe UI,Arial}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:1rem;box-shadow:0 1px 2px rgba(2,6,23,.06)}
    .btn{display:inline-flex;align-items:center;gap:.5rem;border-radius:.75rem;padding:.5rem 1rem;font-weight:500;cursor:pointer;transition:all 0.2s;}
    .btn:active{transform:scale(0.96)}
    .btn-primary{background:#2563eb;color:#fff}
    .btn-primary:hover{background:#1d4ed8}
    .btn-secondary{background:#f1f5f9;color:#334155}
    .btn-secondary:hover{background:#e2e8f0}
    .btn-danger{background:#ef4444;color:#fff}
    .btn-danger:hover{background:#dc2626}
    .inp{width:100%;border:1px solid #e2e8f0;border-radius:.75rem;padding:.5rem .75rem;outline:none;background:#fff}
    .inp:focus{border-color:#93c5fd;box-shadow:0 0 0 4px rgba(59,130,246,.15)}
    .badge{display:inline-flex;align-items:center;border-radius:999px;padding:.25rem .75rem;font-size:.75rem;font-weight:600}
  </style>
</head>
<body class="bg-slate-50 text-slate-900">
  <div id="authScreen" class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-4xl grid md:grid-cols-2 gap-6">
      <div class="card p-6">
        <div class="text-2xl font-bold text-blue-600 flex items-center gap-2">
          <span>🌌</span><span>HTC Universe</span>
        </div>
        <div class="text-slate-600 mt-2 leading-relaxed">
          ระบบเบิก/ยืม/จัดซื้อ + คลังอุปกรณ์ พร้อม Workflow อนุมัติ (HEAD → IT/FINANCE → CEO)
        </div>
        <div class="mt-3 text-sm text-slate-500">
          🌐 เข้าใช้งานจากเครื่องอื่น: <span id="netUni" class="font-medium text-slate-700">กำลังตรวจสอบ IP...</span>
        </div>
      </div>

      <div class="card p-6">
        <div class="flex gap-2">
          <button class="btn btn-secondary" id="tabLogin" onclick="setAuthTab('login')">Login</button>
          <button class="btn btn-secondary" id="tabRegister" onclick="setAuthTab('register')">Register</button>
        </div>

        <div id="loginForm" class="mt-5">
          <div class="text-lg font-semibold">เข้าสู่ระบบ</div>
          <div class="mt-3">
            <label class="text-sm text-slate-600">Username</label>
            <input id="lUser" class="inp mt-1" placeholder="username" onkeypress="if(event.key==='Enter') login()">
          </div>
          <div class="mt-3">
            <label class="text-sm text-slate-600">Password</label>
            <input id="lPass" type="password" class="inp mt-1" placeholder="password" onkeypress="if(event.key==='Enter') login()">
          </div>
          <button class="btn btn-primary w-full justify-center mt-5" onclick="login()">
            <span>🚀</span><span>Login</span>
          </button>
          <div id="lMsg" class="mt-3 text-sm text-red-600"></div>
        </div>

        <div id="registerForm" class="mt-5 hidden">
          <div class="text-lg font-semibold">สมัครสมาชิก</div>
          <div class="mt-3"><label class="text-sm text-slate-600">Username</label><input id="rUser" class="inp mt-1" placeholder="username"></div>
          <div class="mt-3"><label class="text-sm text-slate-600">Password</label><input id="rPass" type="password" class="inp mt-1" placeholder="password"></div>
          <div class="mt-3"><label class="text-sm text-slate-600">Name</label><input id="rName" class="inp mt-1" placeholder="ชื่อ-นามสกุล"></div>
          <div class="mt-3"><label class="text-sm text-slate-600">Email</label><input id="rEmail" class="inp mt-1" placeholder="name@company.com"></div>
          <div class="mt-3"><label class="text-sm text-slate-600">Department</label><input id="rDept" class="inp mt-1" placeholder="Marketing / Sales / ..."></div>
          <button class="btn btn-primary w-full justify-center mt-5" onclick="register()"><span>📝</span><span>Register</span></button>
          <div id="rMsg" class="mt-3 text-sm"></div>
        </div>
      </div>
    </div>
  </div>

  <div id="appScreen" class="hidden min-h-screen">
    <div class="sticky top-0 z-10 bg-white border-b border-slate-200">
      <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="text-blue-600 font-bold text-xl">🌌 HTC Universe</div>
          <a href="/" class="text-sm text-slate-500 hover:text-slate-700">Portal</a>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-sm text-slate-600">
            <span class="font-semibold" id="meName"></span> <span class="text-slate-400">•</span>
            <span id="meRole" class="uppercase"></span> <span class="text-slate-400">•</span>
            <span id="meDept"></span>
          </div>
          <button class="btn btn-secondary" onclick="logout()">Logout</button>
        </div>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 py-6 grid lg:grid-cols-[260px,1fr] gap-6">
      <div class="card p-4 h-fit">
        <div class="font-semibold text-slate-700 mb-2">Menu</div>
        <div class="space-y-2">
          <button class="btn btn-secondary w-full justify-start" id="mDash" onclick="go('dash')">📊 Dashboard</button>
          <button class="btn btn-secondary w-full justify-start" id="mReq" onclick="go('request')">➕ Create Request</button>
          <button class="btn btn-secondary w-full justify-start" id="mMine" onclick="go('mine')">🧾 My Requests</button>
          <button class="btn btn-secondary w-full justify-start hidden" id="mInbox" onclick="go('inbox')">✅ Approvals Inbox</button>
          <button class="btn btn-secondary w-full justify-start" id="mInv" onclick="go('inventory')">📦 Inventory</button>
          <button class="btn btn-secondary w-full justify-start" id="mBorrow" onclick="go('borrow')">🔁 Borrow / Return</button>
          <div class="h-px bg-slate-200 my-2"></div>
          <button class="btn btn-secondary w-full justify-start hidden" id="mUsers" onclick="go('users')">👥 Users (IT)</button>
          <button class="btn btn-secondary w-full justify-start hidden" id="mQuota" onclick="go('quota')">🎯 Quotas (IT)</button>
          <button class="btn btn-secondary w-full justify-start hidden" id="mLogs" onclick="go('logs')">🧩 Logs (IT)</button>
          <button class="btn btn-secondary w-full justify-start hidden" id="mReports" onclick="go('reports')">📈 Reports</button>
        </div>
      </div>

      <div class="space-y-6">
        <div id="pwCard" class="card p-5 hidden border-yellow-200 bg-yellow-50">
          <div class="font-semibold">🔒 กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน</div>
          <div class="grid md:grid-cols-3 gap-3 mt-3">
            <input id="pwOld" type="password" class="inp" placeholder="Old password">
            <input id="pwNew" type="password" class="inp" placeholder="New password (min 4)">
            <button class="btn btn-primary justify-center" onclick="changePassword()">Save</button>
          </div>
          <div id="pwMsg" class="text-sm mt-2"></div>
        </div>

        <section id="vDash" class="space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold text-slate-700">ภาพรวมระบบ (Dashboard)</h2>
            <button class="btn btn-primary" onclick="loadDashKpi()">🔄 อัปเดตข้อมูล</button>
          </div>

          <div class="grid md:grid-cols-4 gap-4">
            <div class="card p-4 border-l-4 border-blue-500">
              <div class="text-slate-500 text-sm">Total Requests</div>
              <div class="text-3xl font-bold mt-1" id="kTotal">0</div>
            </div>
            <div class="card p-4 border-l-4 border-amber-500">
              <div class="text-slate-500 text-sm">Pending</div>
              <div class="text-3xl font-bold mt-1" id="kPending">0</div>
            </div>
            <div class="card p-4 border-l-4 border-emerald-500">
              <div class="text-slate-500 text-sm">Approved</div>
              <div class="text-3xl font-bold mt-1" id="kApproved">0</div>
            </div>
            <div class="card p-4 border-l-4 border-purple-500">
              <div class="text-slate-500 text-sm">Active Borrows</div>
              <div class="text-3xl font-bold mt-1" id="kBorrows">0</div>
            </div>
          </div>

          <div class="grid md:grid-cols-2 gap-4 mt-4">
            <div class="card p-5">
              <div class="font-semibold mb-4 text-slate-700">📈 สถิติแยกตามประเภทคำร้อง</div>
              <canvas id="reqChart" height="200"></canvas>
            </div>
            <div class="card p-5">
              <div class="font-semibold mb-4 text-slate-700">📝 กิจกรรม/คำร้องขอล่าสุด</div>
              <div id="recentLogs" class="space-y-3 max-h-[220px] overflow-y-auto pr-2"></div>
            </div>
          </div>

          <div class="card p-5">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-semibold">Low Stock</div>
                <div class="text-sm text-slate-500">รายการที่สต็อกต่ำกว่าหรือเท่ากับขั้นต่ำ</div>
              </div>
              <button class="btn btn-secondary" onclick="loadLowStock()">Refresh</button>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm">
                <thead class="text-slate-500 border-b">
                  <tr><th class="text-left py-2">Name</th><th class="text-left py-2">Stock</th><th class="text-left py-2">Min</th><th class="text-left py-2">Category</th></tr>
                </thead>
                <tbody id="lowStockBody" class="divide-y divide-slate-100"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="vRequest" class="hidden space-y-4">
          <div class="card p-5">
            <div class="font-semibold text-lg">Create Request</div>
            <div class="text-sm text-slate-500 mt-1">ประเภท: เบิก (WITHDRAW) / ยืม (BORROW) / จัดซื้อ (PURCHASE)</div>
            <div class="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <label class="text-sm text-slate-600">Type</label>
                <select id="rqType" class="inp mt-1"><option value="WITHDRAW">WITHDRAW (เบิก)</option><option value="BORROW">BORROW (ยืม)</option><option value="PURCHASE">PURCHASE (จัดซื้อ)</option></select>
              </div>
              <div>
                <label class="text-sm text-slate-600">Item</label>
                <select id="rqItem" class="inp mt-1"></select>
              </div>
              <div><label class="text-sm text-slate-600">Quantity</label><input id="rqQty" type="number" min="1" class="inp mt-1" value="1"></div>
              <div><label class="text-sm text-slate-600">Image (optional)</label><input id="rqImg" type="file" accept="image/*" class="inp mt-1"></div>
            </div>
            <div class="mt-4"><label class="text-sm text-slate-600">Reason</label><textarea id="rqReason" class="inp mt-1" rows="4" placeholder="เหตุผล/รายละเอียด"></textarea></div>
            <div class="flex flex-wrap gap-2 items-center mt-4">
              <button class="btn btn-primary" onclick="createRequest()">Submit</button>
              <div id="rqMsg" class="text-sm"></div>
            </div>
          </div>
        </section>

        <section id="vMine" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between">
              <div><div class="font-semibold text-lg">My Requests</div><div class="text-sm text-slate-500">ยกเลิกได้เฉพาะสถานะ PENDING</div></div>
              <button class="btn btn-secondary" onclick="loadMy()">Refresh</button>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm">
                <thead class="text-slate-500 border-b"><tr><th class="text-left py-2">ID</th><th class="text-left py-2">Type</th><th class="text-left py-2">Item</th><th class="text-left py-2">Qty</th><th class="text-left py-2">Status</th><th class="text-left py-2">Updated</th><th class="text-left py-2">Action</th></tr></thead>
                <tbody id="mineBody" class="divide-y divide-slate-100"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="vInbox" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between">
              <div><div class="font-semibold text-lg">Approvals Inbox</div><div class="text-sm text-slate-500">งานที่รอการอนุมัติของคุณ</div></div>
              <button class="btn btn-secondary" onclick="loadInbox()">Refresh</button>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm"><thead class="text-slate-500 border-b"><tr><th class="text-left py-2">ID</th><th class="text-left py-2">Dept</th><th class="text-left py-2">Requester</th><th class="text-left py-2">Type</th><th class="text-left py-2">Item</th><th class="text-left py-2">Qty</th><th class="text-left py-2">Reason</th><th class="text-left py-2">Action</th></tr></thead><tbody id="inboxBody" class="divide-y divide-slate-100"></tbody></table>
            </div>
          </div>
        </section>

        <section id="vInventory" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between">
              <div><div class="font-semibold text-lg">Inventory</div><div class="text-sm text-slate-500">รายการอุปกรณ์ในคลัง</div></div>
              <div class="flex gap-2">
                <button class="btn btn-secondary" onclick="loadItems()">Refresh</button>
                <button class="btn btn-primary hidden" id="btnAddItem" onclick="toggleAddItem(true)">Add (IT)</button>
              </div>
            </div>
            <div id="addItemBox" class="mt-4 p-4 rounded-2xl bg-slate-100 hidden">
              <div class="grid md:grid-cols-4 gap-3">
                <input id="itName" class="inp" placeholder="name">
                <input id="itStock" type="number" class="inp" placeholder="stock" value="0">
                <input id="itCategory" class="inp" placeholder="category">
                <input id="itUnit" class="inp" placeholder="unit (pcs/unit)" value="pcs">
                <input id="itMin" type="number" class="inp" placeholder="min_stock" value="0">
                <input id="itPrice" type="number" class="inp" placeholder="price" value="0">
                <select id="itIsAsset" class="inp"><option value="0">is_asset = 0</option><option value="1">is_asset = 1</option></select>
                <input id="itTag" class="inp" placeholder="asset_tag (optional)">
              </div>
              <div class="flex gap-2 mt-3">
                <button class="btn btn-primary" onclick="addItem()">Save</button>
                <button class="btn btn-secondary" onclick="toggleAddItem(false)">Close</button>
                <div id="itMsg" class="text-sm"></div>
              </div>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm"><thead class="text-slate-500 border-b"><tr><th class="text-left py-2">ID</th><th class="text-left py-2">Name</th><th class="text-left py-2">Stock</th><th class="text-left py-2">Min</th><th class="text-left py-2">Unit</th><th class="text-left py-2">Category</th><th class="text-left py-2">Asset</th><th class="text-left py-2">Actions</th></tr></thead><tbody id="itemsBody" class="divide-y divide-slate-100"></tbody></table>
            </div>
          </div>
        </section>

        <section id="vBorrow" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between">
              <div><div class="font-semibold text-lg">Borrow / Return</div><div class="text-sm text-slate-500">รายการยืมที่ยังไม่คืน</div></div>
              <button class="btn btn-secondary" onclick="loadBorrows()">Refresh</button>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm"><thead class="text-slate-500 border-b"><tr><th class="text-left py-2">ID</th><th class="text-left py-2">Borrower</th><th class="text-left py-2">Dept</th><th class="text-left py-2">Item</th><th class="text-left py-2">Qty</th><th class="text-left py-2">Asset tag</th><th class="text-left py-2">Borrowed</th><th class="text-left py-2">Action</th></tr></thead><tbody id="borrowBody" class="divide-y divide-slate-100"></tbody></table>
            </div>
          </div>
        </section>

        <section id="vUsers" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between"><div><div class="font-semibold text-lg">Users (IT)</div></div><button class="btn btn-secondary" onclick="loadUsers()">Refresh</button></div>
            <div class="mt-4 p-4 rounded-2xl bg-slate-100">
              <div class="font-semibold mb-2">Add user</div>
              <div class="grid md:grid-cols-6 gap-3">
                <input id="auUser" class="inp" placeholder="username"><input id="auPass" class="inp" placeholder="password"><input id="auName" class="inp" placeholder="name"><input id="auDept" class="inp" placeholder="department">
                <select id="auRole" class="inp"><option>USER</option><option>HEAD</option><option>IT</option><option>FINANCE</option><option>CEO</option></select>
                <select id="auApproved" class="inp"><option value="0">appr=0</option><option value="1">appr=1</option></select>
              </div>
              <div class="flex gap-2 mt-3"><button class="btn btn-primary" onclick="addUser()">Save</button><div id="uMsg" class="text-sm"></div></div>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm"><thead class="text-slate-500 border-b"><tr><th class="text-left py-2">Username</th><th class="text-left py-2">Name</th><th class="text-left py-2">Role</th><th class="text-left py-2">Dept</th><th class="text-left py-2">Actions</th></tr></thead><tbody id="usersBody" class="divide-y divide-slate-100"></tbody></table>
            </div>
          </div>
        </section>

        <section id="vQuota" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between"><div><div class="font-semibold text-lg">Quotas (IT)</div></div><button class="btn btn-secondary" onclick="loadQuotas()">Refresh</button></div>
            <div class="mt-4 p-4 rounded-2xl bg-slate-100">
              <div class="grid md:grid-cols-4 gap-3"><input id="qDept" class="inp" placeholder="department"><input id="qW" type="number" class="inp" placeholder="withdraw_limit"><input id="qB" type="number" class="inp" placeholder="borrow_limit"><input id="qP" type="number" class="inp" placeholder="purchase_limit"></div>
              <div class="flex gap-2 mt-3"><button class="btn btn-primary" onclick="setQuota()">Save</button><div id="qMsg" class="text-sm"></div></div>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm"><thead class="text-slate-500 border-b"><tr><th class="text-left py-2">Department</th><th class="text-left py-2">Withdraw</th><th class="text-left py-2">Borrow</th><th class="text-left py-2">Purchase</th></tr></thead><tbody id="quotaBody" class="divide-y divide-slate-100"></tbody></table>
            </div>
          </div>
        </section>

        <section id="vLogs" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between">
              <div><div class="font-semibold text-lg">Logs (IT)</div></div>
              <div class="flex flex-wrap gap-2 justify-end">
                <button class="btn btn-secondary" onclick="loadLogs()">Refresh</button>
                <button class="btn btn-secondary" onclick="exportUni('requests')">⬇️ Export</button>
              </div>
            </div>
            <div class="mt-4 overflow-auto">
              <table class="w-full text-sm"><thead class="text-slate-500 border-b"><tr><th class="text-left py-2">Time</th><th class="text-left py-2">User</th><th class="text-left py-2">Action</th><th class="text-left py-2">Details</th></tr></thead><tbody id="logsBody" class="divide-y divide-slate-100"></tbody></table>
            </div>
          </div>
        </section>

        <section id="vReports" class="hidden space-y-4">
          <div class="card p-5">
            <div class="flex items-center justify-between"><div><div class="font-semibold text-lg">Reports</div></div><button class="btn btn-secondary" onclick="loadReports()">Refresh</button></div>
            <div class="grid md:grid-cols-4 gap-4 mt-4">
              <div class="card p-4"><div class="text-slate-500 text-sm">Total</div><div class="text-3xl font-bold mt-1" id="rTotal">0</div></div>
              <div class="card p-4"><div class="text-slate-500 text-sm">Pending</div><div class="text-3xl font-bold mt-1" id="rPending">0</div></div>
              <div class="card p-4"><div class="text-slate-500 text-sm">Approved</div><div class="text-3xl font-bold mt-1" id="rApproved">0</div></div>
              <div class="card p-4"><div class="text-slate-500 text-sm">Rejected</div><div class="text-3xl font-bold mt-1" id="rRejected">0</div></div>
            </div>
            <div class="mt-4 grid md:grid-cols-2 gap-4">
              <div class="card p-4"><div class="font-semibold">Quota Usage</div><div id="rQuota" class="text-sm text-slate-600 mt-2 space-y-1"></div></div>
              <div class="card p-4"><div class="font-semibold">By Status</div><div id="rByStatus" class="text-sm text-slate-600 mt-2 space-y-1"></div></div>
            </div>
          </div>
        </section>

      </div>
    </div>
  </div>

<script>
const API = "/universe/api";
let me = null;
let itemsCache = [];
let reqChartInstance = null;
const SESSION_KEY = "htc_universe_session";

// 1. ระบบจำการล็อคอินด้วย LocalStorage (F5 ไม่หลุด)
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem(SESSION_KEY);
  if(saved){
    try { 
      me = JSON.parse(saved); 
      showApp(); 
    } catch(e) { 
      localStorage.removeItem(SESSION_KEY); 
    }
  }
  loadNetUni();
});

function setAuthTab(tab){
  document.getElementById("loginForm").classList.toggle("hidden", tab!=="login");
  document.getElementById("registerForm").classList.toggle("hidden", tab!=="register");
  document.getElementById("tabLogin").classList.toggle("bg-blue-600", tab==="login");
  document.getElementById("tabLogin").classList.toggle("text-white", tab==="login");
  document.getElementById("tabRegister").classList.toggle("bg-blue-600", tab==="register");
  document.getElementById("tabRegister").classList.toggle("text-white", tab==="register");
}
setAuthTab("login");

function badge(status){
  const s=(status||"").toUpperCase();
  if(s==="APPROVED") return `<span class="badge bg-emerald-100 text-emerald-800">APPROVED</span>`;
  if(s==="REJECTED") return `<span class="badge bg-red-100 text-red-700">REJECTED</span>`;
  if(s==="CANCELLED") return `<span class="badge bg-slate-100 text-slate-600">CANCELLED</span>`;
  if(s==="HEAD_APPROVED") return `<span class="badge bg-blue-100 text-blue-700">HEAD_APPROVED</span>`;
  if(s==="FINANCE_APPROVED") return `<span class="badge bg-purple-100 text-purple-700">FINANCE_APPROVED</span>`;
  return `<span class="badge bg-amber-100 text-amber-700">${s}</span>`;
}

async function postJson(path, body){
  const r = await fetch(API+path, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body||{})});
  return r.json();
}
async function getJson(path, params){
  const u = new URL(API+path, location.origin);
  if(params) Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  const r = await fetch(u);
  return r.json();
}
async function postForm(path, fd){
  const r = await fetch(API+path, {method:"POST", body: fd});
  return r.json();
}

function showApp(){
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appScreen").classList.remove("hidden");
  document.getElementById("meName").innerText = me.name;
  document.getElementById("meRole").innerText = me.role;
  document.getElementById("meDept").innerText = me.department;

  const canInbox = ["HEAD","IT","FINANCE","CEO"].includes(me.role);
  if(document.getElementById("mInbox")) document.getElementById("mInbox").classList.toggle("hidden", !canInbox);
  if(document.getElementById("mUsers")) document.getElementById("mUsers").classList.toggle("hidden", me.role!=="IT");
  if(document.getElementById("mQuota")) document.getElementById("mQuota").classList.toggle("hidden", me.role!=="IT");
  if(document.getElementById("mLogs")) document.getElementById("mLogs").classList.toggle("hidden", me.role!=="IT");
  if(document.getElementById("btnAddItem")) document.getElementById("btnAddItem").classList.toggle("hidden", me.role!=="IT");
  if(document.getElementById("mReports")) document.getElementById("mReports").classList.toggle("hidden", !["IT","FINANCE","CEO"].includes(me.role));

  document.getElementById("pwCard").classList.toggle("hidden", !me.must_change_password);

  go("dash");
  loadItems();
  loadLowStock();
  loadMy();
  if(canInbox) loadInbox();
  loadBorrows();
  if(me.role==="IT") { loadUsers(); loadQuotas(); loadLogs(); }
  if(["IT","FINANCE","CEO"].includes(me.role)) loadReports();
  loadDashKpi();
}

function go(v){
  const map = { dash:"vDash", request:"vRequest", mine:"vMine", inbox:"vInbox", inventory:"vInventory", borrow:"vBorrow", users:"vUsers", quota:"vQuota", logs:"vLogs", reports:"vReports" };
  Object.values(map).forEach(id => { if(document.getElementById(id)) document.getElementById(id).classList.add("hidden"); });
  if(document.getElementById(map[v])) document.getElementById(map[v]).classList.remove("hidden");
}

async function login(){
  document.getElementById("lMsg").innerText="กำลังเข้าสู่ระบบ...";
  const username=document.getElementById("lUser").value.trim();
  const password=document.getElementById("lPass").value.trim();
  const j = await postJson("/login",{username,password});
  if(!j.success){ document.getElementById("lMsg").innerText=j.message||"Login failed"; return; }
  
  me = j.user;
  localStorage.setItem(SESSION_KEY, JSON.stringify(me)); // เซฟลงเครื่อง
  showApp();
}

async function register(){
  const username=document.getElementById("rUser").value.trim();
  const password=document.getElementById("rPass").value.trim();
  const name=document.getElementById("rName").value.trim();
  const department=document.getElementById("rDept").value.trim();
  const email=document.getElementById("rEmail").value.trim();
  const j = await postJson("/register",{username,password,name,department,email});
  const box=document.getElementById("rMsg");
  if(j.success){ box.className="mt-3 text-sm text-emerald-700"; box.innerText="✅ สมัครสำเร็จ (รอ IT อนุมัติ)"; setAuthTab("login"); }
  else { box.className="mt-3 text-sm text-red-600"; box.innerText="❌ "+(j.message||"Register failed"); }
}

function logout(){ 
  localStorage.removeItem(SESSION_KEY); 
  location.reload(); 
}

// 2. ฟังก์ชันโหลดกราฟและ Log สดๆ
async function loadDashKpi(){
  try {
    const all = await getJson("/requests", {actor: me.username, scope:"all"});
    const rows = all.rows || [];
    
    document.getElementById("kTotal").innerText = rows.length;
    document.getElementById("kPending").innerText = rows.filter(x=>x.status==="PENDING").length;
    document.getElementById("kApproved").innerText = rows.filter(x=>x.status==="APPROVED").length;

    try {
      const b = await getJson("/borrow_records", {actor: me.username, active:"1"});
      document.getElementById("kBorrows").innerText = (b.rows||[]).length;
    } catch(e) {}

    // 3. วาดกราฟ Chart.js
    const reqTypes = rows.reduce((acc, curr) => {
        acc[curr.req_type] = (acc[curr.req_type] || 0) + 1;
        return acc;
    }, {});

    const ctx = document.getElementById('reqChart');
    if(ctx){
        if(reqChartInstance) reqChartInstance.destroy();
        reqChartInstance = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: Object.keys(reqTypes).length ? Object.keys(reqTypes) : ['ยังไม่มีข้อมูล'],
                datasets: [{
                    label: 'จำนวนคำร้อง',
                    data: Object.keys(reqTypes).length ? Object.values(reqTypes) : [0],
                    backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'],
                    borderRadius: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
        });
    }

    // 4. ดึง Log คำร้องขอล่าสุดมาโชว์
    const logsHtml = rows.slice(0, 20).map(r => {
      const dateStr = new Date(r.created_at).toLocaleString('th-TH');
      return \`<div class="p-3 border rounded-lg bg-white flex justify-between items-center shadow-sm">
        <div>
           <div class="font-semibold text-sm">#\${r.id} \${escapeHtml(r.item_name)} (\${r.quantity} ชิ้น)</div>
           <div class="text-xs text-slate-500 mt-1">\${escapeHtml(r.requester)} • \${escapeHtml(r.req_type)}</div>
        </div>
        <div class="text-right">
           \${badge(r.status)}
           <div class="text-xs text-slate-400 mt-1">\${dateStr}</div>
        </div>
      </div>\`;
    }).join("");
    if(document.getElementById("recentLogs")){
       document.getElementById("recentLogs").innerHTML = logsHtml || '<div class="text-sm text-slate-500 p-4 text-center">ไม่มีประวัติคำร้องขอ</div>';
    }
    
  } catch(e) { console.error(e); }
}

async function loadItems(){
  itemsCache = await getJson("/items") || [];
  if(document.getElementById("rqItem")){
    document.getElementById("rqItem").innerHTML = itemsCache.map(i=>`<option value="\${escapeHtml(i.name)}">\${escapeHtml(i.name)} (stock \${i.stock})</option>`).join("");
  }
  renderItems(itemsCache);
}
async function loadLowStock(){
  const rows = await getJson("/items/low_stock") || [];
  const tb=document.getElementById("lowStockBody");
  if(tb) tb.innerHTML = rows.length ? rows.map(i=>`<tr><td class="py-2">\${escapeHtml(i.name)}</td><td class="py-2 font-semibold \${i.stock<=0?'text-red-600':''}">\${i.stock}</td><td class="py-2">\${i.min_stock}</td><td class="py-2 text-slate-600">\${escapeHtml(i.category||"-")}</td></tr>`).join("") : `<tr><td class="py-3 text-slate-500 text-center" colspan="4">ไม่มีรายการ</td></tr>`;
}

async function createRequest(){
  const fd = new FormData();
  fd.append("req_type", document.getElementById("rqType").value);
  fd.append("item_name", document.getElementById("rqItem").value);
  fd.append("quantity", document.getElementById("rqQty").value);
  fd.append("reason", document.getElementById("rqReason").value);
  fd.append("requester", me.username);
  fd.append("department", me.department);
  const img=document.getElementById("rqImg").files[0];
  if(img) fd.append("image", img);

  const j = await postForm("/request", fd);
  const box=document.getElementById("rqMsg");
  if(j.success){
    box.className="text-sm text-emerald-700 font-semibold";
    box.innerText="✅ ส่งคำร้องขอสำเร็จ!";
    document.getElementById("rqReason").value="";
    document.getElementById("rqImg").value="";
    loadMy(); loadDashKpi();
    if(["HEAD","IT","FINANCE","CEO"].includes(me.role)) loadInbox();
  } else {
    box.className="text-sm text-red-600";
    box.innerText="❌ "+(j.message||"Error");
  }
}

async function loadMy(){
  const j = await getJson("/requests", {actor:me.username, scope:"mine"});
  const tb=document.getElementById("mineBody");
  if(tb) tb.innerHTML = (j.rows||[]).length ? j.rows.map(r=>`<tr><td class="py-2">#\${r.id}</td><td class="py-2">\${escapeHtml(r.req_type)}</td><td class="py-2">\${escapeHtml(r.item_name||"-")}</td><td class="py-2">\${r.quantity}</td><td class="py-2">\${badge(r.status)} \${r.reject_reason? \`<div class="text-xs text-red-600 mt-1">เหตุผล: \${escapeHtml(r.reject_reason)}</div>\` : ""}</td><td class="py-2 text-slate-600 text-xs">\${escapeHtml(r.created_at)}</td><td class="py-2">\${r.status==="PENDING" ? \`<button class="btn btn-secondary text-xs px-3 py-1" onclick="cancelReq(\${r.id})">Cancel</button>\` : \`<span class="text-slate-400">-</span>\`}</td></tr>`).join("") : `<tr><td class="py-3 text-slate-500 text-center" colspan="7">ไม่มีรายการ</td></tr>`;
}

async function loadInbox(){
  const j = await getJson("/requests", {actor:me.username, scope:"inbox"});
  const tb=document.getElementById("inboxBody");
  if(tb) tb.innerHTML = (j.rows||[]).length ? j.rows.map(r=>`<tr><td class="py-2">#\${r.id}</td><td class="py-2">\${escapeHtml(r.department)}</td><td class="py-2">\${escapeHtml(r.requester)}</td><td class="py-2">\${escapeHtml(r.req_type)}</td><td class="py-2">\${escapeHtml(r.item_name||"-")}</td><td class="py-2">\${r.quantity}</td><td class="py-2 text-slate-600">\${escapeHtml(r.reason||"")}</td><td class="py-2"><div class="flex flex-wrap gap-2"><button class="btn btn-primary text-xs px-3 py-1" onclick="approveReq(\${r.id})">Approve</button><button class="btn btn-danger text-xs px-3 py-1" onclick="rejectReq(\${r.id})">Reject</button></div></td></tr>`).join("") : `<tr><td class="py-3 text-slate-500 text-center" colspan="8">ไม่มีงานค้างอนุมัติ</td></tr>`;
}

async function cancelReq(id){
  const j = await postJson(\`/requests/\${id}/cancel\`, {actor:me.username});
  if(!j.success) return alert(j.message||"Error");
  loadMy(); loadDashKpi();
}
async function approveReq(id){
  const j = await postJson(\`/requests/\${id}/approve\`, {actor:me.username});
  if(!j.success) return alert(j.message||"Error");
  loadInbox(); loadMy(); loadItems(); loadLowStock(); loadDashKpi(); loadBorrows();
}
async function rejectReq(id){
  const reason = prompt("ระบุเหตุผลที่ปฏิเสธ:");
  if(!reason) return;
  const j = await postJson(\`/requests/\${id}/reject\`, {actor:me.username, reason});
  if(!j.success) return alert(j.message||"Error");
  loadInbox(); loadMy(); loadDashKpi();
}

async function loadBorrows(){
  const j = await getJson("/borrow_records", {actor:me.username, active:"1"});
  const tb=document.getElementById("borrowBody");
  if(tb) tb.innerHTML = (j.rows||[]).length ? j.rows.map(b=>`<tr><td class="py-2">#\${b.id}</td><td class="py-2">\${escapeHtml(b.borrower)}</td><td class="py-2">\${escapeHtml(b.department)}</td><td class="py-2">\${escapeHtml(b.item_name)}</td><td class="py-2">\${b.quantity}</td><td class="py-2 text-slate-600">\${escapeHtml(b.asset_tag||"-")}</td><td class="py-2 text-slate-600 text-xs">\${escapeHtml(b.borrowed_at||"-")}</td><td class="py-2"><button class="btn btn-secondary text-xs px-3 py-1" onclick="returnBorrow(\${b.id})">Return</button></td></tr>`).join("") : `<tr><td class="py-3 text-slate-500 text-center" colspan="8">ไม่มีรายการยืมค้าง</td></tr>`;
}
async function returnBorrow(id){
  const j = await postJson(\`/borrow_records/\${id}/return\`, {actor:me.username});
  if(!j.success) return alert(j.message||"Error");
  loadBorrows(); loadItems(); loadLowStock(); loadDashKpi();
}

function escapeHtml(s){ return (s||"").toString().replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

function renderItems(rows){
  const tb=document.getElementById("itemsBody");
  if(!tb) return;
  tb.innerHTML = rows.map(i=>`<tr><td class="py-2">\${i.id}</td><td class="py-2 font-semibold">\${escapeHtml(i.name)}</td><td class="py-2 \${i.stock<=0?'text-red-600 font-semibold':''}">\${i.stock}</td><td class="py-2">\${i.min_stock||0}</td><td class="py-2">\${escapeHtml(i.unit||"")}</td><td class="py-2 text-slate-600">\${escapeHtml(i.category||"")}</td><td class="py-2">\${i.is_asset?\`<span class="badge bg-indigo-100 text-indigo-700">ASSET</span>\`:\`<span class="badge bg-slate-100 text-slate-600">-</span>\`}</td><td class="py-2"><span class="text-slate-400">-</span></td></tr>`).join("");
}
async function loadUsers(){ const j = await getJson("/users", {actor:me.username}); const tb = document.getElementById("usersBody"); if(tb) tb.innerHTML = (j.rows||[]).map(u=>`<tr><td>\${escapeHtml(u.username)}</td><td>\${escapeHtml(u.name)}</td><td>\${u.role}</td><td>\${escapeHtml(u.department)}</td><td>-</td></tr>`).join(""); }
async function loadQuotas(){ const j = await getJson("/quotas", {actor:me.username}); const tb = document.getElementById("quotaBody"); if(tb) tb.innerHTML = (j.rows||[]).map(q=>`<tr><td>\${escapeHtml(q.department)}</td><td>\${q.withdraw_limit}</td><td>\${q.borrow_limit}</td><td>\${q.purchase_limit}</td></tr>`).join(""); }
async function loadLogs(){ const j = await getJson("/logs", {actor:me.username, limit:200}); const tb = document.getElementById("logsBody"); if(tb) tb.innerHTML = (j.rows||[]).map(l=>`<tr><td class="text-xs">\${escapeHtml(l.timestamp)}</td><td>\${escapeHtml(l.user)}</td><td>\${escapeHtml(l.action)}</td><td class="text-slate-500">\${escapeHtml(l.details)}</td></tr>`).join(""); }
async function loadReports(){ const j = await getJson("/reports", {actor:me.username}); if(!j.success) return; document.getElementById("rTotal").innerText = j.total||0; document.getElementById("rPending").innerText = j.pending||0; document.getElementById("rApproved").innerText = j.approved||0; document.getElementById("rRejected").innerText = j.rejected||0; }

async function loadNetUni(){
  try{
    const r = await fetch("/api/meta"); const j = await r.json(); const ips = (j.ips||[]).filter(Boolean);
    const el = document.getElementById("netUni");
    if(el) el.innerText = ips.length ? \`http://\${ips[0]}:\${j.port||3000}\` : "ไม่พบ IP วงแลน";
  }catch(e){}
}
</script>
</body>
</html>
// --- HTML END ---
*/
