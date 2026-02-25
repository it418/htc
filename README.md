# HTC Portal Bundle (IT Ticket + HTC Universe) ✅ (Single IP / Single Port)

ระบบรวม 2 โมดูลไว้ในเว็บเดียว (พอร์ตเดียว) ผ่านหน้า Portal:
- **IT Ticket System**: /it
- **HTC Universe** (เบิก/ยืม/จัดซื้อ + คลัง + workflow อนุมัติ): /universe

---

## วิธีรันด้วย Docker (แนะนำ)
```bash
docker compose up --build
```

เปิดเว็บ:
- Portal: http://localhost:3000/
- IT Ticket: http://localhost:3000/it/login.html
- Universe: http://localhost:3000/universe/

> หมายเหตุ: เวอร์ชันนี้ออกแบบให้ใช้ **Turso/libSQL** เป็นฐานข้อมูล (เหมาะกับ Vercel)


---

## วิธีรันด้วย Node (สำหรับ dev)
1) ติดตั้ง Node.js (แนะนำ Node 18+)
2) สร้างไฟล์ `.env` จาก `.env.example` แล้วใส่ค่า Turso ของคุณ:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `JWT_SECRET`
3) ในโฟลเดอร์นี้:
```bash
npm install
npm start
```

---

## Deploy ขึ้น Vercel (แนะนำ)
เวอร์ชันนี้ออกแบบให้รันบน Vercel ได้เสถียร โดยใช้ **Turso/libSQL (ฐานข้อมูลถาวร)**

> ข้อจำกัด Vercel: payload สำหรับอัปโหลดไฟล์มีเพดาน (แนะนำตั้ง `MAX_UPLOAD_MB=4`)

### วิธี Deploy
1) Push ขึ้น GitHub
2) เข้า Vercel → New Project → Import repo
3) Deploy ได้เลย (มี `vercel.json` + `api/index.js` รองรับแล้ว)

### ENV ที่ควรตั้งใน Vercel
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `JWT_SECRET` : ตั้งเป็นค่าสุ่มยาวๆ (สำคัญ)
- (แนะนำ) `MAX_UPLOAD_MB=4`

---

## แชร์ให้เพื่อนใน LAN (Single IP)
เปิดด้วย IP เครื่องคุณ เช่น:
- http://192.168.1.195:3000/

> IP เป็นตัวอย่าง — ใช้ ipconfig/ifconfig ดู IP จริงของเครื่องคุณ

---

## Default Accounts

### IT Ticket
- Admin: **admin@local** / **admin1234**
- Agent: **agent@local** / **agent1234**
- User: **user@local** / **user1234**

> หลัง admin reset password ผู้ใช้จะถูกบังคับให้เปลี่ยนรหัสก่อนใช้งาน

### Universe (seed)
- admin / 123   (IT)
- head_mkt / 123 (HEAD Marketing)
- head_sales / 123 (HEAD Sales)
- fin / 123 (FINANCE)
- ceo / 123 (CEO)

---

## Notes
- `it/public` รองรับ `bg.png` ถ้าคุณมีไฟล์ `bg.png` เดิม ให้เอามาวางทับได้เลย
- IT attachments จะถูกเก็บเป็น BLOB ในฐานข้อมูล และเปิดดูผ่านลิงก์ API
