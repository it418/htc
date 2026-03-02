
// -------------------------
// API base (bulletproof)
// -------------------------
// This app is often deployed behind reverse proxies/sub-paths.
// To make Login/Register work everywhere, we:
// 1) derive the primary base from the directory of THIS script (most reliable)
// 2) try a few fallback candidates and auto-pick the first one that responds

const SCRIPT_DIR = (() => {
  try {
    const src = document.currentScript && document.currentScript.src;
    if (src) return new URL('.', src).pathname.replace(/\/+$/, '/')
  } catch {}

  // Fallback: attempt to infer from the current path
  const p = location.pathname || '/';
  const m = p.match(/^(.*\/universe)(?:\/|$)/);
  if (m) return (m[1] + '/');
  if (p.endsWith('/')) return p;
  if ((p.split('/').pop() || '').includes('.')) return p.slice(0, p.lastIndexOf('/') + 1);
  return p + '/';
})();

let API = (SCRIPT_DIR.replace(/\/+$/, '') + '/api');
let _apiReadyPromise = null;

function _uniq(arr){
  const out=[];
  for (const v of (arr||[])) if (v && !out.includes(v)) out.push(v);
  return out;
}

function _apiCandidates(){
  // primary: same folder as script
  const primary = (SCRIPT_DIR.replace(/\/+$/, '') + '/api');
  const candidates = [
    primary,
    '/universe/api',
  ];
  // If running under something like /portal/universe/, also try stripping to /universe/api
  try {
    const m = location.pathname.match(/^(.*\/universe)(?:\/|$)/);
    if (m) candidates.unshift(m[1] + '/api');
  } catch {}

  return _uniq(candidates.map(c => String(c).replace(/\/+$/, '')));
}

async function ensureApi(){
  if (_apiReadyPromise) return _apiReadyPromise;

  const candidates = _apiCandidates();
  const primary = candidates[0] || API || '/universe/api';
  API = String(primary).replace(/\/+$/, '');

  _apiReadyPromise = (async () => {
    for (const base0 of candidates) {
      const base = String(base0 || '').replace(/\/+$/, '');
      if (!base) continue;
      try {
        const r = await fetch(base + '/_debug/db', { cache: 'no-store' });
        const txt = await r.text();
        let j = null;
        try { j = JSON.parse(txt); } catch { j = null; }
        if (j && j.ok === true) {
          API = base;
          return API;
        }
      } catch {}
    }
    // If none match, keep primary; API calls will show proper error in UI.
    return API;
  })();

  return _apiReadyPromise;
}
let me=null,itemsCache=[],cType=null,cStat=null,rpDept=null,rpType=null,logTrend=null,logAction=null;
function esc(s){const d=document.createElement("div");d.textContent=s||"";return d.innerHTML}
function toast(m,t="info"){const c=document.getElementById("toast");const e=document.createElement("div");e.className=`toast ${t==="success"?"ok":t==="error"?"err":"info"}`;e.textContent=m;c.appendChild(e);setTimeout(()=>{e.style.opacity=0;setTimeout(()=>e.remove(),300)},3500)}

async function safeJson(r){const t=await r.text();try{return JSON.parse(t)}catch{return{success:false,message:t||"Error"}}}
async function postJson(path,body){
  try{
    const base = await ensureApi();
    const r=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})});
    const j=await safeJson(r);
    return r.ok?j:Object.assign({success:false,message:j.message||j.error||"Error"},j)
  }catch(e){return{success:false,message:"Network: "+e.message}}
}
async function getJson(path,params){
  try{
    const base = await ensureApi();
    const u=new URL(base+path,location.origin);
    if(params)Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
    const r=await fetch(u);
    const j=await safeJson(r);
    return r.ok?j:Object.assign({success:false,message:j.message||j.error||"Error"},j)
  }catch(e){return{success:false,message:"Network: "+e.message}}
}
async function postForm(path,fd){
  try{
    const base = await ensureApi();
    const r=await fetch(base+path,{method:"POST",body:fd});
    const j=await safeJson(r);
    return r.ok?j:Object.assign({success:false,message:j.message||j.error||"Error"},j)
  }catch(e){return{success:false,message:"Network: "+e.message}}
}

function badge(s){
  const color={PENDING:"amber",HEAD_APPROVED:"blue",FINANCE_APPROVED:"purple",APPROVED:"green",REJECTED:"red",CANCELLED:"gray"};
  const label={PENDING:"\u0e23\u0e2d\u0e2b\u0e31\u0e27\u0e2b\u0e19\u0e49\u0e32",HEAD_APPROVED:"\u0e2b\u0e31\u0e27\u0e2b\u0e19\u0e49\u0e32\u0e2d\u0e19\u0e38\u0e21\u0e31\u0e15\u0e34",FINANCE_APPROVED:"Finance \u0e2d\u0e19\u0e38\u0e21\u0e31\u0e15\u0e34",APPROVED:"\u0e2d\u0e19\u0e38\u0e21\u0e31\u0e15\u0e34\u0e41\u0e25\u0e49\u0e27",REJECTED:"\u0e1b\u0e0f\u0e34\u0e40\u0e2a\u0e18",CANCELLED:"\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01"};
  return `<span class="badge ${color[s]||"gray"}">${label[s]||s}</span>`;
}
function typeBadge(t){return t==="WITHDRAW"?'<span class="badge blue">\ud83d\udce4 \u0e40\u0e1a\u0e34\u0e01</span>':t==="BORROW"?'<span class="badge amber">\ud83d\udd04 \u0e22\u0e37\u0e21</span>':t==="PURCHASE"?'<span class="badge purple">\ud83d\uded2 \u0e0b\u0e37\u0e49\u0e2d</span>':`<span class="badge gray">${t}</span>`}

// ===== AUTH =====
function setAuthTab(t){document.getElementById("loginForm").style.display=t==="login"?"block":"none";document.getElementById("registerForm").style.display=t==="register"?"block":"none";document.querySelectorAll(".auth-tab").forEach(e=>e.classList.remove("act"));document.getElementById(t==="login"?"tabLogin":"tabRegister").classList.add("act")}

async function login(){
  const u=document.getElementById("lUser").value.trim(),p=document.getElementById("lPass").value;
  if(!u||!p){document.getElementById("lMsg").innerHTML='<span style="color:#f87171">\u0e01\u0e23\u0e2d\u0e01\u0e43\u0e2b\u0e49\u0e04\u0e23\u0e1a</span>';return}
  const j=await postJson("/login",{username:u,password:p});
  if(j.success){me=j.user;localStorage.setItem("htc_universe_user",JSON.stringify(me));showApp()}
  else document.getElementById("lMsg").innerHTML=`<span style="color:#f87171">${esc(j.message)}</span>`}

async function register(){
  const u=document.getElementById("rUser").value.trim(),p=document.getElementById("rPass").value,n=document.getElementById("rName").value.trim(),e=document.getElementById("rEmail").value.trim(),d=document.getElementById("rDept").value.trim();
  if(!u||!p||!n||!e||!d){document.getElementById("rMsg").innerHTML='<span style="color:#f87171">\u0e01\u0e23\u0e2d\u0e01\u0e43\u0e2b\u0e49\u0e04\u0e23\u0e1a</span>';return}
  const j=await postJson("/register",{username:u,password:p,name:n,department:d,email:e});
  if(j.success){document.getElementById("rMsg").innerHTML='<span style="color:#34d399">\u2705 \u0e2a\u0e21\u0e31\u0e04\u0e23\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08! \u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a...</span>';setTimeout(()=>{document.getElementById("lUser").value=u;document.getElementById("lPass").value=p;setAuthTab("login");login()},1000)}
  else document.getElementById("rMsg").innerHTML=`<span style="color:#f87171">${esc(j.message)}</span>`}

function logoutUni(){localStorage.removeItem("htc_universe_user");location.reload()}

function showApp(){
  document.getElementById("authScreen").style.display="none";document.getElementById("appScreen").style.display="flex";document.body.classList.add("app");
  document.getElementById("meName").textContent=me.name||me.username;document.getElementById("meRole").textContent=me.role||"USER";document.getElementById("meDept").textContent=me.department||"-";document.getElementById("meAv").textContent=(me.name||me.username||"?")[0].toUpperCase();
  const canInbox=["HEAD","IT","FINANCE","CEO"].includes(me.role);
  if(canInbox)document.getElementById("mInbox").classList.remove("hid");
  if(me.role==="IT"){["mUsers","mQuota","mLogs","secAdmin","btnAddItem","thInvAct"].forEach(id=>{const e=document.getElementById(id);if(e)e.classList.remove("hid")})}
  if(["IT","FINANCE","CEO"].includes(me.role))document.getElementById("mReports").classList.remove("hid");
  if(me.must_change_password)document.getElementById("pwCard").style.display="block";
  go("dash");loadItems();loadLowStock();loadMy();if(canInbox)loadInbox();loadBorrows();
}

async function changePw(){const o=document.getElementById("pwOld").value,n=document.getElementById("pwNew").value;if(!o||!n)return;const j=await postJson("/change_password",{actor:me.username,old_password:o,new_password:n});if(j.success){toast("\u2705 \u0e40\u0e1b\u0e25\u0e35\u0e48\u0e22\u0e19\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08","success");document.getElementById("pwCard").style.display="none"}else toast(j.message,"error")}

// ===== VIEW SWITCH =====
function go(v){document.querySelectorAll(".view").forEach(e=>e.classList.remove("act"));document.querySelectorAll(".menu .mi").forEach(e=>e.classList.remove("act"));
  const sec=document.getElementById("v-"+v);if(sec)sec.classList.add("act");const btn=document.getElementById({"dash":"mDash","request":"mReq","mine":"mMine","inbox":"mInbox","inventory":"mInv","borrow":"mBorrow","users":"mUsers","quota":"mQuota","logs":"mLogs","reports":"mReports"}[v]);if(btn)btn.classList.add("act");
  if(v==="dash")loadDashKpi();else if(v==="mine")loadMy();else if(v==="inbox")loadInbox();else if(v==="inventory")loadItems();else if(v==="borrow")loadBorrows();else if(v==="users")loadUsers();else if(v==="quota")loadQuotas();else if(v==="logs")loadLogs();else if(v==="reports")loadReports();else if(v==="request"){fillItemSelect();onTypeChange();}
}
function refreshView(){const act=document.querySelector(".view.act");if(act){const v=act.id.replace("v-","");go(v)}}

// ===== DASHBOARD =====
async function loadDashKpi(){
  try{
    const rep=await getJson("/reports",{actor:me.username});
    if(rep && rep.success!==false){
      const total=Number(rep.total ?? rep.total_requests ?? 0);
      const pending=Number(rep.pending ?? 0);
      const approved=Number(rep.approved ?? 0);
      const rejected=Number(rep.rejected ?? 0);

      document.getElementById("dTotal").textContent=total;
      document.getElementById("dPending").textContent=pending;
      document.getElementById("dApproved").textContent=approved;
      document.getElementById("dRejected").textContent=rejected;

      // Type chart
      if(cType) cType.destroy();
      const byType=rep.byType || rep.by_type || [];
      cType=new Chart(document.getElementById("chartType"),{
        type:"doughnut",
        data:{labels:byType.map(r=>r.req_type),datasets:[{data:byType.map(r=>r.count),backgroundColor:["#3b82f6","#f59e0b","#8b5cf6"],borderWidth:3,borderColor:"#fff"}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:"60%",plugins:{legend:{position:"bottom",labels:{padding:14,usePointStyle:true,font:{family:"Kanit",size:11}}}}}
      });

      // Status chart
      if(cStat) cStat.destroy();
      const byStatus=rep.byStatus || rep.by_status || [];
      const stC={PENDING:"#f59e0b",HEAD_APPROVED:"#3b82f6",FINANCE_APPROVED:"#8b5cf6",APPROVED:"#10b981",REJECTED:"#ef4444",CANCELLED:"#94a3b8"};
      cStat=new Chart(document.getElementById("chartStat"),{
        type:"bar",
        data:{labels:byStatus.map(r=>r.status),datasets:[{data:byStatus.map(r=>r.count),backgroundColor:byStatus.map(r=>stC[r.status]||"#94a3b8"),borderRadius:10,barThickness:20}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0,font:{family:"Kanit"}}},x:{ticks:{font:{family:"Kanit",size:9},maxRotation:45}}}}
      });
    }
  }catch(e){}

  // Low stock
  const ls=await getJson("/items/low_stock")||[];
  document.getElementById("lowStockDash").innerHTML=ls.length
    ? ls.slice(0,5).map(i=>`<div class="low-stock"><i class="fa-solid fa-triangle-exclamation" style="color:#dc2626"></i><span style="flex:1">${esc(i.name)}</span><span class="badge">${Number(i.stock||0)}/${Number(i.min_stock||0)}</span></div>`).join("")
    : '<div class="muted" style="font-size:13px;text-align:center;padding:20px">\u0e2a\u0e15\u0e47\u0e2d\u0e01\u0e1b\u0e01\u0e15\u0e34 \u2705</div>';

  // Active borrows
  const brj=await getJson("/borrow_records",{actor:me.username,active:"1"})||{};
  const br=(brj.rows||[]);
  document.getElementById("activeBorrowDash").innerHTML=br.slice(0,5).map(b=>`<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px"><i class="fa-solid fa-arrow-right-arrow-left" style="color:#d97706"></i><span style="flex:1;font-weight:500">${esc(b.item_name||"-")}</span><span class="muted">${esc(b.borrower||"-")}</span><span class="badge amber">${(b.borrowed_at||"").slice(0,10)}</span></div>`).join("") || '<div class="muted" style="font-size:13px;text-align:center;padding:20px">\u0e44\u0e21\u0e48\u0e21\u0e35 \u2705</div>';
}


// ===== INVENTORY =====
async function loadItems(){
  const j=await getJson("/items")||[];
  itemsCache=Array.isArray(j)?j:(j.rows||j.items||[]);
  document.getElementById("invBody").innerHTML=itemsCache.map(i=>{
    const low=Number(i.stock||0)<=Number(i.min_stock||0) && Number(i.min_stock||0)>0;
    return `<tr>
      <td style="padding-left:16px">${i.id}</td>
      <td style="font-weight:500">${esc(i.name)}</td>
      <td><span class="badge gray">${esc(i.category||"-")}</span></td>
      <td style="${low?"color:#dc2626;font-weight:700":""}">${Number(i.stock||0)}</td>
      <td class="muted">${Number(i.min_stock||0)}</td>
      <td class="hid">${me&&me.role==="IT"?`<button class="btn sm sec" onclick="editItem(${i.id})"><i class="fa-solid fa-pen"></i></button> <button class="btn sm danger" onclick="deleteItem(${i.id})"><i class="fa-solid fa-trash"></i></button>`:""}</td>
    </tr>`;
  }).join("");
}

async function loadLowStock(){const rows=await getJson("/items/low_stock")||[];/*populated in dashboard*/}
function fillItemSelect(){
  const sel=document.getElementById("reqItem");
  sel.innerHTML='<option value="">-- \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e04\u0e25\u0e31\u0e07 --</option>'+(itemsCache||[]).map(i=>`<option value="${i.id}">${esc(i.name)} (${Number(i.stock||0)})</option>`).join("");
}

function toggleAddItem(s){const box=document.getElementById("addItemBox");box.classList.toggle("hid",!s)}
async function addItem(){
  const n=document.getElementById("iName").value.trim();
  const c=document.getElementById("iCat").value.trim();
  const stock=Number(document.getElementById("iQty").value||0);
  const m=Number(document.getElementById("iMin").value||0);
  if(!n){toast("\u0e43\u0e2a\u0e48\u0e0a\u0e37\u0e48\u0e2d","error");return}
  const j=await postJson("/items/add",{actor:me.username,name:n,category:c,stock,min_stock:m});
  if(j.success){toast("\u2705 \u0e40\u0e1e\u0e34\u0e48\u0e21\u0e41\u0e25\u0e49\u0e27","success");toggleAddItem(false);loadItems();fillItemSelect();loadDashKpi();}
  else toast(j.message,"error");
}

async function editItem(id){
  const i=itemsCache.find(x=>x.id===id);if(!i)return;
  const n=prompt("Name:",i.name);if(!n)return;
  const q=prompt("Stock:",i.stock);if(q===null)return;
  const m=prompt("Min Stock:",i.min_stock);if(m===null)return;
  const c=prompt("Category:",i.category||"");if(c===null)return;
  const j=await postJson("/items/update",{actor:me.username,id,name:n,stock:Number(q),min_stock:Number(m),category:c});
  if(j.success){toast("\u2705","success");loadItems();fillItemSelect();loadDashKpi();}
  else toast(j.message,"error");
}

async function deleteItem(id){if(!confirm("\u0e25\u0e1a?"))return;const j=await postJson("/items/delete",{actor:me.username,id});if(j.success){toast("Deleted","success");loadItems()}else toast(j.message,"error")}

// ===== REQUEST =====
function onTypeChange(){
  const t=document.getElementById("reqType").value;
  document.getElementById("borrowDaysBox").style.display=t==="BORROW"?"block":"none";
  // \u0e40\u0e1e\u0e37\u0e48\u0e2d UX \u0e17\u0e35\u0e48\u0e0a\u0e31\u0e14\u0e40\u0e08\u0e19: \u0e40\u0e1a\u0e34\u0e01/\u0e22\u0e37\u0e21 \u0e15\u0e49\u0e2d\u0e07\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e04\u0e25\u0e31\u0e07, \u0e02\u0e2d\u0e0b\u0e37\u0e49\u0e2d\u0e04\u0e48\u0e2d\u0e22\u0e1e\u0e34\u0e21\u0e1e\u0e4c\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e40\u0e2d\u0e07
  const cn=document.getElementById("customNameBox");
  if(cn) cn.style.display=(t==="PURCHASE")?"block":"none";
}
async function createReq(){
  const type=document.getElementById("reqType").value;
  const itemIdStr=document.getElementById("reqItem").value;
  const custom=(document.getElementById("reqCustom").value||"").trim();
  const qty=Math.max(1, Number(document.getElementById("reqQty").value||1));
  const reason=(document.getElementById("reqReason").value||"").trim();
  const days=Math.max(1, Number(document.getElementById("reqDays").value||7));
  const link=(document.getElementById("reqLink").value||"").trim();

  // Resolve item name
  let itemName="";
  if(itemIdStr){
    const it=itemsCache.find(x=>x.id===Number(itemIdStr));
    if(it) itemName=it.name;
  }

  if(type==="PURCHASE"){
    if(!itemName) itemName=custom;
    if(!itemName){document.getElementById("reqMsg").innerHTML='<span style="color:#dc2626">\u274c \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2b\u0e23\u0e37\u0e2d\u0e01\u0e23\u0e2d\u0e01\u0e0a\u0e37\u0e48\u0e2d\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23</span>';return}
  }else{
    // WITHDRAW / BORROW \u0e15\u0e49\u0e2d\u0e07\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e04\u0e25\u0e31\u0e07 (backend \u0e15\u0e23\u0e27\u0e08 stock)
    if(!itemName){document.getElementById("reqMsg").innerHTML='<span style="color:#dc2626">\u274c \u0e40\u0e1a\u0e34\u0e01/\u0e22\u0e37\u0e21 \u0e15\u0e49\u0e2d\u0e07\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e04\u0e25\u0e31\u0e07</span>';return}
  }

  if(!me||!me.username||!me.department){
    document.getElementById("reqMsg").innerHTML='<span style="color:#dc2626">\u274c \u0e01\u0e23\u0e38\u0e13\u0e32 Login \u0e43\u0e2b\u0e21\u0e48</span>';return;
  }

  let finalReason=reason;
  if(type==="BORROW"){
    finalReason=(finalReason?finalReason+"\n":"")+`(\u0e23\u0e30\u0e22\u0e30\u0e22\u0e37\u0e21 ${days} \u0e27\u0e31\u0e19)`;
  }

  const body={
    req_type:type,
    item_name:itemName,
    quantity:qty,
    reason:finalReason,
    requester:me.username,
    department:me.department,
    image_url:link
  };

  document.getElementById("reqMsg").innerHTML='<span style="color:var(--p)"><i class="fa-solid fa-spinner fa-spin"></i></span>';
  const j=await postJson("/request",body);
  if(j.success){
    toast(`\u2705 #${j.id||""} \u2014 \u0e41\u0e08\u0e49\u0e07 Chat \u0e41\u0e25\u0e49\u0e27!`,"success");
    ["reqCustom","reqReason","reqLink"].forEach(id=>{const e=document.getElementById(id);if(e)e.value=""});
    document.getElementById("reqItem").value="";
    document.getElementById("reqQty").value="1";
    document.getElementById("reqMsg").innerHTML='<span style="color:#059669">\u2705</span>';
    setTimeout(()=>go("mine"),700);
  }else{
    document.getElementById("reqMsg").innerHTML=`<span style="color:#dc2626">\u274c ${esc(j.message||j.error||"Error")}</span>`;
  }
}


// ===== MY REQUESTS =====
async function loadMy(){const j=await getJson("/requests",{actor:me.username,scope:"mine"});const rows=j.rows||j.requests||[];
  document.getElementById("myEmpty").style.display=rows.length?"none":"block";
  document.getElementById("myBody").innerHTML=rows.map(r=>`<tr><td style="padding-left:16px;font-weight:600;color:var(--p)">#${r.id}</td><td>${typeBadge(r.req_type)}</td><td style="font-weight:500">${esc(r.item_name)}</td><td>${r.quantity}</td><td>${badge(r.status)}</td><td class="muted" style="font-size:12px">${(r.created_at||"").slice(0,10)}</td><td>${r.status==="PENDING"?`<button class="btn sm danger" onclick="cancelReq(${r.id})"><i class="fa-solid fa-xmark"></i> \u0e22\u0e01\u0e40\u0e25\u0e34\u0e01</button>`:""}</td></tr>`).join("")}
async function cancelReq(id){if(!confirm("\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01 #"+id+"?"))return;const j=await postJson(`/requests/${id}/cancel`,{actor:me.username});if(j.success){toast("Cancelled","success");loadMy()}else toast(j.message,"error")}

// ===== INBOX =====
async function loadInbox(){const j=await getJson("/requests",{actor:me.username,scope:"inbox"});const rows=j.rows||j.requests||[];
  document.getElementById("inboxEmpty").style.display=rows.length?"none":"block";
  if(rows.length){document.getElementById("inboxCt").style.display="inline";document.getElementById("inboxCt").textContent=rows.length}else document.getElementById("inboxCt").style.display="none";
  document.getElementById("inboxBody").innerHTML=rows.map(r=>`<tr><td style="padding-left:16px;font-weight:600;color:var(--p)">#${r.id}</td><td>${typeBadge(r.req_type)}</td><td style="font-weight:500">${esc(r.item_name)}</td><td>${r.quantity}</td><td style="font-size:12px">${esc(r.requester||"")}</td><td style="font-size:12px">${esc(r.department||"")}</td><td>${badge(r.status)}</td><td style="display:flex;gap:6px"><button class="btn sm ok" onclick="approveReq(${r.id})"><i class="fa-solid fa-check"></i></button><button class="btn sm danger" onclick="rejectReq(${r.id})"><i class="fa-solid fa-xmark"></i></button></td></tr>`).join("")}
async function approveReq(id){const j=await postJson(`/requests/${id}/approve`,{actor:me.username});if(j.success){toast("\u2705 Approved \u2014 \u0e41\u0e08\u0e49\u0e07 Chat \u0e41\u0e25\u0e49\u0e27!","success");loadInbox();loadMy()}else toast(j.message,"error")}
async function rejectReq(id){const reason=prompt("\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25\u0e17\u0e35\u0e48\u0e1b\u0e0f\u0e34\u0e40\u0e2a\u0e18:");if(reason===null)return;const j=await postJson(`/requests/${id}/reject`,{actor:me.username,reason:reason||"-"});if(j.success){toast("\u274c Rejected \u2014 \u0e41\u0e08\u0e49\u0e07 Chat \u0e41\u0e25\u0e49\u0e27!","success");loadInbox()}else toast(j.message,"error")}

// ===== BORROW =====
async function loadBorrows(){
  const j=await getJson("/borrow_records",{actor:me.username,active:"1"});const rows=j.rows||[];
  document.getElementById("borrowEmpty").style.display=rows.length?"none":"block";
  document.getElementById("borrowBody").innerHTML=rows.map(b=>{
    const due = b.due_date ? String(b.due_date).slice(0,10) : "-";
    return `<tr>
      <td style="padding-left:16px">${b.id}</td>
      <td style="font-weight:500">${esc(b.item_name||"-")}</td>
      <td style="font-size:12px">${esc(b.borrower||"")}</td>
      <td>${b.quantity||1}</td>
      <td class="muted" style="font-size:12px">${(b.borrowed_at||"").slice(0,10)}</td>
      <td class="muted" style="font-size:12px">${due}</td>
      <td>${b.returned_at?'<span class="badge green">\u0e04\u0e37\u0e19\u0e41\u0e25\u0e49\u0e27</span>':'<span class="badge amber">\u0e22\u0e37\u0e21\u0e2d\u0e22\u0e39\u0e48</span>'}</td>
      <td>${!b.returned_at&&(me.role==="IT"||me.username===b.borrower)?`<button class="btn sm ok" onclick="returnBorrow(${b.id})"><i class="fa-solid fa-undo"></i> \u0e04\u0e37\u0e19</button>`:""}</td>
    </tr>`;
  }).join("");
}
async function returnBorrow(id){
  const j=await postJson(`/borrow_records/${id}/return`,{actor:me.username});
  if(j.success){toast("\u2705 \u0e04\u0e37\u0e19\u0e41\u0e25\u0e49\u0e27","success");loadBorrows();loadItems();loadDashKpi();}
  else toast(j.message,"error");
}


// ===== USERS =====
async function loadUsers(){
  const j=await getJson("/users",{actor:me.username});
  const rows=j.rows||j.users||[];
  document.getElementById("usersBody").innerHTML=rows.map(u=>{
    const approved=Number(u.is_approved||0)===1;
    const locked=Number(u.is_locked||0)===1;
    const deleted=Number(u.is_deleted||0)===1;
    const role=String(u.role||"USER").toUpperCase();
    const dept=esc(u.department||"");
    return `<tr>
      <td style="padding-left:16px;font-weight:500">${esc(u.username)}</td>
      <td>${esc(u.name||"")}</td>
      <td>
        <select class="badge" style="border:1px solid var(--border);padding:4px 8px;cursor:pointer;font-family:var(--font)"
          onchange="updateUser('${esc(u.username)}',this.value,${approved?1:0},'${dept}',${locked?1:0})">
          ${["USER","HEAD","IT","FINANCE","CEO"].map(r=>`<option ${r===role?"selected":""}>${r}</option>`).join("")}
        </select>
      </td>
      <td style="font-size:12px">${dept||"-"}</td>
      <td>${deleted?'<span class="badge red">Deleted</span>':locked?'<span class="badge amber">Locked</span>':approved?'<span class="badge green">Active</span>':'<span class="badge gray">Pending</span>'}</td>
      <td style="font-size:12px;display:flex;gap:4px;flex-wrap:wrap">
        ${!approved && !deleted ? `<button class="btn sm ok" onclick="updateUser('${esc(u.username)}','${role}',1,'${dept}',0)">Approve</button>` : ""}
        ${!deleted ? (locked
          ? `<button class="btn sm sec" onclick="updateUser('${esc(u.username)}','${role}',${approved?1:0},'${dept}',0)">Unlock</button>`
          : `<button class="btn sm sec" onclick="updateUser('${esc(u.username)}','${role}',${approved?1:0},'${dept}',1)">Lock</button>`) : ""}
        ${deleted
          ? `<button class="btn sm ok" onclick="restoreUser('${esc(u.username)}')">Restore</button>`
          : `<button class="btn sm danger" onclick="deleteUser('${esc(u.username)}')">Del</button>`}
        <button class="btn sm sec" onclick="resetUserPw('${esc(u.username)}')">ResetPW</button>
      </td>
    </tr>`;
  }).join("");
}


function showAddUser(){const u=prompt("Username:");if(!u)return;const p=prompt("Password:");if(!p)return;const n=prompt("Name:");const d=prompt("Department:");const r=prompt("Role (USER/HEAD/IT/FINANCE/CEO):","USER");const e=prompt("Email:");postJson("/users/add",{actor:me.username,username:u,password:p,name:n||u,department:d||"",role:r||"USER",email:e||"",approved:1}).then(j=>{if(j.success){toast("\u2705","success");loadUsers()}else toast(j.message,"error")})}
function showImportUsers(){const csv=prompt("Paste CSV (username,password,name,department,role,email per line):");if(!csv)return;postJson("/users/import_csv",{actor:me.username,csv}).then(j=>{if(j.success){toast(`Created: ${j.created}, Skipped: ${j.skipped}`,"success");loadUsers()}else toast(j.message,"error")})}
async function updateUser(target,role,approved,department,locked){const j=await postJson("/users/update",{actor:me.username,target,role,approved,department,locked});if(j.success){toast("\u2705","success");loadUsers()}else toast(j.message,"error")}
async function deleteUser(target){if(!confirm("Delete "+target+"?"))return;const j=await postJson("/users/soft_delete",{actor:me.username,target});if(j.success){toast("Deleted","success");loadUsers()}else toast(j.message,"error")}
async function restoreUser(target){const j=await postJson("/users/restore",{actor:me.username,target});if(j.success){toast("Restored","success");loadUsers()}else toast(j.message,"error")}
async function resetUserPw(target){const j=await postJson("/users/reset_password",{actor:me.username,target});if(j.success)alert("Temp PW: "+(j.temp_password||j.password||"check logs"));else toast(j.message,"error")}

// ===== QUOTAS =====
async function loadQuotas(){
  const q=await getJson("/quotas",{actor:me.username});
  const rows=q.rows||q.quotas||[];
  const rep=await getJson("/reports",{actor:me.username});
  const usage=(rep.quotaUsage||[]);

  const useMap={}; // dept -> {WITHDRAW:x,BORROW:y,PURCHASE:z}
  usage.forEach(u=>{
    const d=u.department||"-";
    useMap[d]=useMap[d]||{WITHDRAW:0,BORROW:0,PURCHASE:0};
    useMap[d][u.req_type]=Number(u.used||0);
  });

  const ym=(rep.month||new Date().toISOString().slice(0,7));
  const ymEl=document.getElementById("qYm"); if(ymEl) ymEl.value=ym;

  document.getElementById("quotaBody").innerHTML=rows.map(r=>{
    const d=r.department||"-";
    const used=useMap[d]||{WITHDRAW:0,BORROW:0,PURCHASE:0};
    const wd=`${used.WITHDRAW||0}/${Number(r.withdraw_limit||0)}`;
    const bw=`${used.BORROW||0}/${Number(r.borrow_limit||0)}`;
    const pc=`${used.PURCHASE||0}/${Number(r.purchase_limit||0)}`;
    const warn=(u,l)=> (Number(l||0)>0 && Number(u||0)>=Number(l||0)) ? 'style="color:#dc2626;font-weight:700"' : "";
    return `<tr>
      <td style="padding-left:16px;font-weight:500">${esc(d)}</td>
      <td ${warn(used.WITHDRAW,r.withdraw_limit)}>${wd}</td>
      <td ${warn(used.BORROW,r.borrow_limit)}>${bw}</td>
      <td ${warn(used.PURCHASE,r.purchase_limit)}>${pc}</td>
    </tr>`;
  }).join("");
}
async function setQuota(){
  const dept=document.getElementById("qDept").value.trim();
  const withdraw_limit=Number(document.getElementById("qWithdraw").value||0);
  const borrow_limit=Number(document.getElementById("qBorrow").value||0);
  const purchase_limit=Number(document.getElementById("qPurchase").value||0);
  if(!dept){toast("\u0e43\u0e2a\u0e48 Department","error");return}
  const j=await postJson("/quotas/set",{actor:me.username,department:dept,withdraw_limit,borrow_limit,purchase_limit});
  if(j.success){toast("\u2705","success");loadQuotas()}else toast(j.message,"error");
}


// ===== LOGS =====
async function loadLogs(){
  const j=await getJson("/logs",{actor:me.username,limit:200});
  const rows=j.rows||j.logs||[];
  document.getElementById("logsBody").innerHTML=rows.map(l=>`<tr>
    <td style="padding-left:16px" class="muted" style="font-size:12px">${(l.timestamp||l.created_at||"").replace("T"," ").slice(0,19)}</td>
    <td style="font-weight:500;font-size:12px">${esc(l.user||l.actor||"")}</td>
    <td><span class="badge gray">${esc(l.action||"")}</span></td>
    <td style="font-size:12px">${esc(l.details||l.detail||"")}</td>
  </tr>`).join("");

  // Charts (last 14 days)
  const byDay={};
  const byAction={};
  rows.forEach(r=>{
    const d=(r.timestamp||r.created_at||"").slice(0,10) || "unknown";
    byDay[d]=(byDay[d]||0)+1;
    const a=r.action||"UNKNOWN";
    byAction[a]=(byAction[a]||0)+1;
  });

  const days=Object.keys(byDay).sort().slice(-14);
  const dayCounts=days.map(d=>byDay[d]);

  if(logTrend)logTrend.destroy();
  const dayCanvas=document.getElementById("logChartDay");
  if(dayCanvas){
    logTrend=new Chart(dayCanvas,{
      type:"line",
      data:{labels:days.map(d=>d.slice(5)),datasets:[{data:dayCounts,fill:true,tension:.35,borderColor:"#10b981",backgroundColor:"rgba(16,185,129,.10)",pointRadius:3}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0,font:{family:"Kanit"}}},x:{ticks:{font:{family:"Kanit"}}}}}
    });
  }

  const acts=Object.entries(byAction).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if(logAction)logAction.destroy();
  const actCanvas=document.getElementById("logChartAction");
  if(actCanvas){
    logAction=new Chart(actCanvas,{
      type:"doughnut",
      data:{labels:acts.map(x=>x[0]),datasets:[{data:acts.map(x=>x[1]),borderWidth:3,borderColor:"#fff"}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:"62%",plugins:{legend:{position:"bottom",labels:{padding:12,usePointStyle:true,font:{family:"Kanit",size:11}}}}}
    });
  }
}


// ===== REPORTS =====
async function loadReports(){
  const j=await getJson("/reports",{actor:me.username});
  if(!j || j.success===false) return;

  // KPIs
  const total=Number(j.total ?? j.total_requests ?? 0);
  const items=Number(j.total_items ?? j.total_items_legacy ?? 0);
  const users=Number(j.total_users ?? j.total_users_legacy ?? 0);

  document.getElementById("rpTotal").textContent=total;
  document.getElementById("rpItems").textContent=items || (Array.isArray(itemsCache)?itemsCache.length:0);
  document.getElementById("rpUsers").textContent=users;

  // By Department
  if(rpDept)rpDept.destroy();
  const bd=j.byDept || j.by_department || [];
  rpDept=new Chart(document.getElementById("rpChartDept"),{
    type:"bar",
    data:{labels:bd.map(d=>d.department||"-"),datasets:[{data:bd.map(d=>d.count),backgroundColor:"rgba(16,185,129,.7)",borderRadius:10,barThickness:24}]},
    options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0,font:{family:"Kanit"}}},y:{ticks:{font:{family:"Kanit"}}}}}
  });

  // By Type
  if(rpType)rpType.destroy();
  const bt=j.byType || j.by_type || [];
  rpType=new Chart(document.getElementById("rpChartType"),{
    type:"doughnut",
    data:{labels:bt.map(t=>t.req_type),datasets:[{data:bt.map(t=>t.count),backgroundColor:["#3b82f6","#f59e0b","#8b5cf6"],borderWidth:3,borderColor:"#fff"}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"60%",plugins:{legend:{position:"bottom",labels:{padding:14,usePointStyle:true,font:{family:"Kanit",size:12}}}}}
  });
}

async function exportData(kind){
  const base = await ensureApi();
  if(kind==="requests")window.open(`${base}/export/requests.csv?actor=${encodeURIComponent(me.username)}&ts=`+Date.now(),"_blank");
  if(kind==="inventory")window.open(`${base}/export/inventory.csv?actor=${encodeURIComponent(me.username)}&ts=`+Date.now(),"_blank");
}

// ===== INIT =====
const saved=localStorage.getItem("htc_universe_user");
if(saved){try{me=JSON.parse(saved);showApp()}catch{localStorage.removeItem("htc_universe_user")}}

// warm-up API base resolution early (so Login/Register are instant)
try { ensureApi(); } catch {}


// Expose functions for inline HTML handlers (onclick/onchange/onkeypress)
window.addItem = addItem;
window.approveReq = approveReq;
window.cancelReq = cancelReq;
window.changePw = changePw;
window.createReq = createReq;
window.deleteItem = deleteItem;
window.deleteUser = deleteUser;
window.editItem = editItem;
window.exportData = exportData;
window.go = go;
window.loadBorrows = loadBorrows;
window.loadInbox = loadInbox;
window.loadItems = loadItems;
window.loadLogs = loadLogs;
window.loadMy = loadMy;
window.loadQuotas = loadQuotas;
window.login = login;
window.logoutUni = logoutUni;
window.onTypeChange = onTypeChange;
window.refreshView = refreshView;
window.register = register;
window.rejectReq = rejectReq;
window.resetUserPw = resetUserPw;
window.restoreUser = restoreUser;
window.returnBorrow = returnBorrow;
window.setAuthTab = setAuthTab;
window.setQuota = setQuota;
window.showAddUser = showAddUser;
window.showImportUsers = showImportUsers;
window.toggleAddItem = toggleAddItem;
window.updateUser = updateUser;
