# موقع طلاب حاسبات - Cloudflare Realtime

## البنية
- Cloudflare Worker
- Durable Object + SQLite
- WebSocket للمزامنة الفورية
- Cloudflare R2 للصور/الفيديوهات المرفوعة
- Static Assets للواجهة

## التشغيل
1. أنشئ R2 bucket باسم `student-projects-media` في Cloudflare، أو غيّر `bucket_name` في wrangler.toml.
2. من مجلد المشروع نفّذ `npx wrangler login`.
3. نفّذ `npx wrangler deploy`.

## دخول الكونترول أول مرة
يمكنك تحديد بيانات الدخول قبل النشر:
`npx wrangler secret put ADMIN_USER`
`npx wrangler secret put ADMIN_PASSWORD`

إذا لم تضع Secrets، سيعمل الإعداد الأولي على:
- المستخدم: `admin`
- كلمة المرور: `admin1234`

غيّر بيانات الكونترول فور أول دخول.
