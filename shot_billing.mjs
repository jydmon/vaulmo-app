import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--force-color-profile=srgb']});
const p=await b.newPage({viewport:{width:1280,height:900},deviceScaleFactor:2});
p.on('console',m=>{if(m.type()==='error')console.log('JSERR',m.text())});
await p.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'}); await sleep(600);
// login page: type password, click Show, screenshot
await p.fill('input[type=email]','admin@lifehub.local');
await p.fill('input[type=password]','ChangeMe123!');
const showLink=p.locator('a',{hasText:/^Show$/}).first();
if(await showLink.count()){ await showLink.click(); await sleep(300); }
await p.screenshot({path:'/home/claude/shots/login-showpw.png'});
console.log('shot login-showpw');
// login
await p.click('button[type=submit]'); await sleep(2500);
const nav=await p.locator('nav.nav button').allInnerTexts(); console.log('nav',JSON.stringify(nav));
await p.locator('nav.nav button',{hasText:'Subscriptions'}).first().click(); await sleep(1400);
await p.screenshot({path:'/home/claude/shots/admin-billing.png', fullPage:true});
console.log('shot admin-billing');
await b.close(); console.log('done');
