# موقع طلاب حاسبات - Cloudflare Realtime

## البنية
- Cloudflare Worker
- Durable Object + SQLite
- WebSocket للمزامنة الفورية
- روابط URLs للصور والفيديوهات محفوظة في Durable Object + SQLite
- Static Assets للواجهة

## التشغيل
1. لا تحتاج إلى إنشاء خدمة تخزين ملفات خارجية. الصور والفيديوهات المضافة من الكونترول تُحفظ كروابط URLs فقط في قاعدة البيانات.
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
