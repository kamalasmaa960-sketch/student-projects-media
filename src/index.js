const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, Authorization', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };

function uid(prefix='id') { return `${prefix}_${crypto.randomUUID()}`; }
function enc(s) { return new TextEncoder().encode(s); }
function hex(buf) { return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc(s))); }
function auth(req) { const h=req.headers.get('authorization')||''; return h.startsWith('Bearer ')?h.slice(7):''; }

export class ProjectDatabase {
  constructor(state, env) { this.state=state; this.env=env; this.ready=this.init(); }
  async init() {
    const s=this.state.storage.sql;
    s.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, level TEXT, department TEXT, cover_url TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS project_images (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT, sort_order INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS project_videos (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT, type TEXT DEFAULT 'external', sort_order INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS project_sections (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, sort_order INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    s.exec(`CREATE TABLE IF NOT EXISTS conversation_members (conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(conversation_id,user_id))`);
    s.exec(`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    if (!s.exec(`SELECT key FROM settings WHERE key='site'`).toArray().length) s.exec(`INSERT INTO settings(key,value) VALUES('site',?)`, JSON.stringify({name:'طلاب حاسبات',subtitle:'منصة عرض مشروعات وتواصل الطلاب',logo:'',primary:'#2563eb',accent:'#7c3aed'}));
    if (!s.exec(`SELECT id FROM admins LIMIT 1`).toArray().length) {
      const user=this.env.ADMIN_USER||'admin', pass=this.env.ADMIN_PASSWORD||'admin1234';
      s.exec(`INSERT INTO admins(id,username,password_hash,created_at) VALUES(?,?,?,?)`, uid('admin'), user, await sha256(pass), Date.now());
    }
  }
  async broadcast(event, data={}) {
    const clients=this.state.getWebSockets(); const msg=JSON.stringify({event,data,at:Date.now()});
    for (const ws of clients) { try { ws.send(msg); } catch {} }
  }
  async validSession(token, role) { if(!token) return null; const r=this.state.storage.sql.exec(`SELECT * FROM sessions WHERE token=? AND expires_at>?`, token, Date.now()).toArray()[0]; return r && (!role || r.role===role) ? r : null; }
  async fetch(req) {
    await this.ready;
    const url=new URL(req.url), path=url.pathname;
    if (path==='/ws') return this.ws(req);
    if (req.method==='OPTIONS') return new Response('',{headers:cors});
    try {
      if(path==='/api/site' && req.method==='GET') return this.site();
      if(path==='/api/projects' && req.method==='GET') return this.projects();
      if(path.startsWith('/api/projects/') && req.method==='GET') return this.project(path.split('/')[3]);
      if(path==='/api/admin/login' && req.method==='POST') return this.adminLogin(req);
      if(path==='/api/admin/me' && req.method==='GET') return this.me(req,'admin');
      if(path==='/api/admin/settings' && req.method==='PATCH') return this.updateSettings(req);
      if(path==='/api/admin/credentials' && req.method==='PATCH') return this.credentials(req);
      if(path==='/api/projects' && req.method==='POST') return this.createProject(req);
      if(path.startsWith('/api/projects/') && req.method==='PATCH') return this.updateProject(req,path.split('/')[3]);
      if(path.startsWith('/api/projects/') && req.method==='DELETE') return this.deleteProject(req,path.split('/')[3]);
      if(path==='/api/students/register' && req.method==='POST') return this.register(req);
      if(path==='/api/students/login' && req.method==='POST') return this.studentLogin(req);
      if(path==='/api/students/me' && req.method==='GET') return this.me(req,'student');
      if(path==='/api/conversations' && req.method==='GET') return this.conversations(req);
      if(path==='/api/conversations' && req.method==='POST') return this.createConversation(req);
      if(path.startsWith('/api/conversations/') && req.method==='GET') return this.messages(req,path.split('/')[3]);
      if(path.startsWith('/api/conversations/') && req.method==='POST') return this.sendMessage(req,path.split('/')[3]);
      if(path==='/api/upload' && req.method==='POST') return this.upload(req);
      return json({error:'Not found'},404,cors);
    } catch(e) { return json({error:e?.message||'Server error'},500,cors); }
  }
  site(){ const r=this.state.storage.sql.exec(`SELECT value FROM settings WHERE key='site'`).toArray()[0]; return json(JSON.parse(r.value),200,cors); }
  projects(){ const s=this.state.storage.sql, ps=s.exec(`SELECT * FROM projects ORDER BY created_at DESC`).toArray(); const out=ps.map(p=>{p.images=s.exec(`SELECT * FROM project_images WHERE project_id=? ORDER BY sort_order,created_at`,p.id).toArray();p.videos=s.exec(`SELECT * FROM project_videos WHERE project_id=? ORDER BY sort_order,created_at`,p.id).toArray();p.sections=s.exec(`SELECT * FROM project_sections WHERE project_id=? ORDER BY sort_order,created_at`,p.id).toArray();return p}); return json(out,200,cors); }
  project(id){ const s=this.state.storage.sql,p=s.exec(`SELECT * FROM projects WHERE id=?`,id).toArray()[0]; if(!p)return json({error:'Project not found'},404,cors); p.images=s.exec(`SELECT * FROM project_images WHERE project_id=? ORDER BY sort_order,created_at`,id).toArray();p.videos=s.exec(`SELECT * FROM project_videos WHERE project_id=? ORDER BY sort_order,created_at`,id).toArray();p.sections=s.exec(`SELECT * FROM project_sections WHERE project_id=? ORDER BY sort_order,created_at`,id).toArray();return json(p,200,cors); }
  async adminLogin(req){ const b=await req.json(), r=this.state.storage.sql.exec(`SELECT * FROM admins WHERE username=?`,b.username||'').toArray()[0]; if(!r || (await sha256(b.password||''))!==r.password_hash)return json({error:'بيانات الكونترول غير صحيحة'},401,cors); const token=uid('sess');this.state.storage.sql.exec(`INSERT INTO sessions(token,user_id,role,expires_at) VALUES(?,?,?,?)`, token,r.id,'admin',Date.now()+1000*60*60*24*30); return json({token},200,cors); }
  async me(req,role){ const x=await this.validSession(auth(req),role); return x?json({ok:true,role:x.role},200,cors):json({error:'Unauthorized'},401,cors); }
  async requireAdmin(req){ const x=await this.validSession(auth(req),'admin'); if(!x)throw new Error('Unauthorized'); return x; }
  async register(req){ const b=await req.json(); if(!b.username||!b.password||!b.displayName) return json({error:'أكمل بيانات الحساب'},400,cors); try{const id=uid('usr');this.state.storage.sql.exec(`INSERT INTO users(id,username,password_hash,display_name,created_at) VALUES(?,?,?,?,?)`,id,b.username,await sha256(b.password),b.displayName,Date.now());return json({ok:true},201,cors)}catch{return json({error:'اسم المستخدم مستخدم بالفعل'},409,cors)} }
  async studentLogin(req){ const b=await req.json(),r=this.state.storage.sql.exec(`SELECT * FROM users WHERE username=?`,b.username||'').toArray()[0];if(!r||(await sha256(b.password||''))!==r.password_hash)return json({error:'بيانات الدخول غير صحيحة'},401,cors);const token=uid('sess');this.state.storage.sql.exec(`INSERT INTO sessions(token,user_id,role,expires_at) VALUES(?,?,?,?)`,token,r.id,'student',Date.now()+1000*60*60*24*30);return json({token,user:{id:r.id,username:r.username,displayName:r.display_name}},200,cors); }
  async createProject(req){await this.requireAdmin(req);const b=await req.json(),id=uid('proj'),now=Date.now();this.state.storage.sql.exec(`INSERT INTO projects(id,name,level,department,cover_url,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,id,b.name||'مشروع بدون اسم',b.level||'',b.department||'',b.coverUrl||'',now,now);await this.replaceChildren(id,b);await this.broadcast('project_created',await this.projectData(id));return json(await this.projectData(id),201,cors)}
  async updateProject(req,id){await this.requireAdmin(req);const b=await req.json();this.state.storage.sql.exec(`UPDATE projects SET name=?,level=?,department=?,cover_url=?,updated_at=? WHERE id=?`,b.name,b.level,b.department,b.coverUrl||'',Date.now(),id);await this.replaceChildren(id,b,true);await this.broadcast('project_updated',await this.projectData(id));return json(await this.projectData(id),200,cors)}
  async replaceChildren(id,b,keep=false){const s=this.state.storage.sql;if(!keep){s.exec(`DELETE FROM project_images WHERE project_id=?`,id);s.exec(`DELETE FROM project_videos WHERE project_id=?`,id);s.exec(`DELETE FROM project_sections WHERE project_id=?`,id)}else{if(Array.isArray(b.images)){s.exec(`DELETE FROM project_images WHERE project_id=?`,id); } if(Array.isArray(b.videos)){s.exec(`DELETE FROM project_videos WHERE project_id=?`,id)} if(Array.isArray(b.sections)){s.exec(`DELETE FROM project_sections WHERE project_id=?`,id)}}const now=Date.now();(b.images||[]).forEach((x,i)=>s.exec(`INSERT INTO project_images(id,project_id,url,title,sort_order,created_at) VALUES(?,?,?,?,?,?)`,x.id||uid('img'),id,x.url,x.title||'',i,now));(b.videos||[]).forEach((x,i)=>s.exec(`INSERT INTO project_videos(id,project_id,url,title,type,sort_order,created_at) VALUES(?,?,?,?,?,?,?)`,x.id||uid('vid'),id,x.url,x.title||'',x.type||'external',i,now));(b.sections||[]).forEach((x,i)=>s.exec(`INSERT INTO project_sections(id,project_id,title,body,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,x.id||uid('sec'),id,x.title||'',x.body||'',i,now,now));}
  projectData(id){const s=this.state.storage.sql,p=s.exec(`SELECT * FROM projects WHERE id=?`,id).toArray()[0];if(!p)return null;p.images=s.exec(`SELECT * FROM project_images WHERE project_id=? ORDER BY sort_order,created_at`,id).toArray();p.videos=s.exec(`SELECT * FROM project_videos WHERE project_id=? ORDER BY sort_order,created_at`,id).toArray();p.sections=s.exec(`SELECT * FROM project_sections WHERE project_id=? ORDER BY sort_order,created_at`,id).toArray();return p}
  async deleteProject(req,id){await this.requireAdmin(req);const s=this.state.storage.sql;const files=[...s.exec(`SELECT url FROM project_images WHERE project_id=?`,id).toArray(),...s.exec(`SELECT url FROM project_videos WHERE project_id=? AND type='upload'`,id).toArray()];s.exec(`DELETE FROM project_images WHERE project_id=?`,id);s.exec(`DELETE FROM project_videos WHERE project_id=?`,id);s.exec(`DELETE FROM project_sections WHERE project_id=?`,id);s.exec(`DELETE FROM projects WHERE id=?`,id);for(const f of files){try{await this.env.MEDIA.delete(new URL(f.url).pathname.split('/').pop())}catch{}}await this.broadcast('project_deleted',{id});return json({ok:true},200,cors)}
  async updateSettings(req){await this.requireAdmin(req);const b=await req.json();this.state.storage.sql.exec(`UPDATE settings SET value=? WHERE key='site'`,JSON.stringify(b));await this.broadcast('branding_updated',b);return json(b,200,cors)}
  async credentials(req){const x=await this.requireAdmin(req),b=await req.json();if(!b.username||!b.password)return json({error:'أدخل اسم المستخدم وكلمة المرور'},400,cors);this.state.storage.sql.exec(`UPDATE admins SET username=?,password_hash=? WHERE id=?`,b.username,await sha256(b.password),x.user_id);return json({ok:true},200,cors)}
  async conversations(req){const x=await this.validSession(auth(req),'student');if(!x)return json({error:'Unauthorized'},401,cors);const s=this.state.storage.sql, rows=s.exec(`SELECT c.id,c.updated_at FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=? ORDER BY c.updated_at DESC`,x.user_id).toArray();return json(rows.map(c=>({...c,members:s.exec(`SELECT u.id,u.display_name,u.username FROM users u JOIN conversation_members m ON m.user_id=u.id WHERE m.conversation_id=?`,c.id).toArray(),last:s.exec(`SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 1`,c.id).toArray()[0]||null})),200,cors)}
  async createConversation(req){const x=await this.validSession(auth(req),'student');if(!x)return json({error:'Unauthorized'},401,cors);const b=await req.json(),target=this.state.storage.sql.exec(`SELECT id FROM users WHERE username=?`,b.username||'').toArray()[0];if(!target||target.id===x.user_id)return json({error:'الطالب غير موجود'},404,cors);const existing=this.state.storage.sql.exec(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=? JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=?`,x.user_id,target.id).toArray()[0];if(existing)return json({id:existing.id},200,cors);const id=uid('conv'),now=Date.now();this.state.storage.sql.exec(`INSERT INTO conversations(id,created_at,updated_at) VALUES(?,?,?)`,id,now,now);this.state.storage.sql.exec(`INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?),(?,?)`,id,x.user_id,id,target.id);await this.broadcast('conversation_created',{id});return json({id},201,cors)}
  async messages(req,id){const x=await this.validSession(auth(req),'student');if(!x)return json({error:'Unauthorized'},401,cors);if(!this.state.storage.sql.exec(`SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?`,id,x.user_id).toArray().length)return json({error:'Forbidden'},403,cors);return json(this.state.storage.sql.exec(`SELECT m.*,u.display_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at`,id).toArray(),200,cors)}
  async sendMessage(req,id){const x=await this.validSession(auth(req),'student');if(!x)return json({error:'Unauthorized'},401,cors);if(!this.state.storage.sql.exec(`SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?`,id,x.user_id).toArray().length)return json({error:'Forbidden'},403,cors);const b=await req.json(),m={id:uid('msg'),conversation_id:id,sender_id:x.user_id,body:String(b.body||'').trim(),created_at:Date.now()};if(!m.body)return json({error:'الرسالة فارغة'},400,cors);this.state.storage.sql.exec(`INSERT INTO messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)`,m.id,id,x.user_id,m.body,m.created_at);this.state.storage.sql.exec(`UPDATE conversations SET updated_at=? WHERE id=?`,m.created_at,id);await this.broadcast('message_created',{...m,display_name:this.state.storage.sql.exec(`SELECT display_name FROM users WHERE id=?`,x.user_id).toArray()[0].display_name});return json(m,201,cors)}
  async upload(req){await this.requireAdmin(req);if(!this.env.MEDIA)return json({error:'R2 غير مربوط'},500,cors);const form=await req.formData(),file=form.get('file');if(!(file instanceof File))return json({error:'لم يتم إرسال ملف'},400,cors);const key=`uploads/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;await this.env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});const base=new URL(req.url);const url=`${base.origin}/media/${key}`;return json({url,key,name:file.name,type:file.type,size:file.size},201,cors)}
  ws(req){if(req.headers.get('Upgrade')!=='websocket')return new Response('Expected WebSocket',{status:426});const pair=new WebSocketPair();this.state.acceptWebSocket(pair[1]);pair[1].send(JSON.stringify({event:'connected',data:{ok:true}}));return new Response(null,{status:101,webSocket:pair[0]})}
  async webSocketMessage(ws,msg){ try{const b=JSON.parse(msg);if(b.type==='ping')ws.send(JSON.stringify({event:'pong'}));}catch{} }
  async webSocketClose(){}
  async webSocketError(){}
}

export default { async fetch(req,env,ctx){
  const url=new URL(req.url);
  if(url.pathname.startsWith('/media/')){
    if(!env.MEDIA)return new Response('R2 not configured',{status:503});
    const key=url.pathname.slice('/media/'.length),obj=await env.MEDIA.get(key);if(!obj)return new Response('Not found',{status:404});
    const h=new Headers();obj.writeHttpMetadata(h);h.set('cache-control','public,max-age=31536000,immutable');return new Response(obj.body,{headers:h});
  }
  const id=env.DB.idFromName('main');const stub=env.DB.get(id);return stub.fetch(req);
}};
