import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const API='http://127.0.0.1:4000/api/v1'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function jf(m,p,b,t){const h={};if(t)h.authorization='Bearer '+t;if(b!==undefined)h['content-type']='application/json';const r=await fetch(API+p,{method:m,headers:h,body:b!==undefined?JSON.stringify(b):undefined});const x=await r.text();let j=null;try{j=x?JSON.parse(x):null}catch{j=x};return{status:r.status,json:j};}
// customer + ticket
const email='support@demo.test';
await jf('POST','/auth/register',{email,password:'Customer12345',fullName:'Priya Patel'});
const cl=await jf('POST','/auth/login',{email,password:'Customer12345'}); const ct=cl.json.accessToken;
const tk=await jf('POST','/support/tickets',{subject:"Can't upload my passport scan",priority:'high',body:'When I try to add my passport the upload spins and never finishes. iPhone, latest app.'},ct);
// admin reply
const al=await jf('POST','/auth/login',{email:'admin@lifehub.local',password:'ChangeMe123!'}); const at=al.json.accessToken;
const list=await jf('GET','/admin/support/tickets',undefined,at);
const tid=(list.json.tickets||[])[0]?.id;
if(tid) await jf('POST','/admin/support/tickets/'+tid+'/messages',{body:'Thanks Priya — could you tell me the file size and format? In the meantime, try a photo (JPG) under 10MB. We’re looking into the spinner.'},at);
console.log('seeded ticket', tid);

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--force-color-profile=srgb']});
async function shot(email,pw,label,file,openTicket){
  const p=await b.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2});
  await p.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'}); await sleep(500);
  await p.fill('input[type=email]',email); await p.fill('input[type=password]',pw);
  await p.click('button[type=submit]'); await sleep(2500);
  await p.locator('nav.nav button',{hasText:'Support'}).first().click(); await sleep(1200);
  if(openTicket){ const row=p.locator('table tbody tr, .row').filter({hasText:/passport/i}).first(); if(await row.count()){ await row.click(); await sleep(1200);} }
  await p.screenshot({path:'/home/claude/shots/'+file, fullPage:true}); console.log('shot',file);
  await p.close();
}
await shot('admin@lifehub.local','ChangeMe123!','admin','support-admin.png',false);
await shot('admin@lifehub.local','ChangeMe123!','admin','support-admin-detail.png',true);
await shot('support@demo.test','Customer12345','cust','support-tenant.png',true);
await b.close(); console.log('done');
