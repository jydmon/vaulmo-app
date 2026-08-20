/**
 * Marketing-site CMS smoke test.
 *
 * Public pages are readable (with defaults) and CORS-open; an admin can edit a page and
 * the change is reflected publicly; a non-admin cannot edit; reset restores the default.
 */
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { createApp } from '../src/app';
import { pool, db } from '../src/db/client';
import { users } from '../src/db/schema';

const PORT = 4108; const base = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = '') => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${d}`)); };
async function api(method: string, url: string, token?: string, body?: any) {
  const h: any = {}; if (token) h.authorization = `Bearer ${token}`; if (body !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  return { status: r.status, j, headers: r.headers };
}
async function adminSession(): Promise<string> {
  await db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.email, 'admin@lifehub.local'));
  const l = await api('POST', '/api/v1/auth/login', undefined, { email: 'admin@lifehub.local', password: 'ChangeMe123!' });
  const tok = l.j?.accessToken;
  const enroll = await api('POST', '/api/v1/mfa/enroll', tok, {});
  const conf = await api('POST', '/api/v1/mfa/confirm', tok, { code: authenticator.generate(enroll.j.secret) });
  return conf.j?.accessToken ?? tok;
}

async function main() {
  const app = createApp(); const server = app.listen(PORT); await new Promise((r) => setTimeout(r, 300));

  // Public: all pages present (from defaults), CORS-open.
  const pub = await api('GET', '/api/v1/site/pages');
  const slugs = (pub.j?.pages ?? []).map((p: any) => p.slug);
  ok('public pages served', pub.status === 200 && slugs.includes('home') && slugs.includes('faq') && slugs.includes('contact'), JSON.stringify(slugs));
  ok('public pages send permissive CORS', pub.headers.get('access-control-allow-origin') === '*');
  const faq = await api('GET', '/api/v1/site/pages/faq');
  ok('single page has default content', faq.status === 200 && Array.isArray(faq.j?.content?.items) && faq.j.content.items.length >= 1);

  // A normal user cannot edit site content.
  const email = `site+${Date.now()}@example.com`; const password = 'SiteUser123!';
  await api('POST', '/api/v1/auth/register', undefined, { email, password, fullName: 'Site User' });
  const login = await api('POST', '/api/v1/auth/login', undefined, { email, password });
  const utok = login.j?.accessToken;
  const forbidden = await api('PUT', '/api/v1/site/admin/pages/home', utok, { content: { heroTitle: 'Hacked' } });
  ok('non-admin cannot edit (403)', forbidden.status === 403, `→ ${forbidden.status}`);

  // Admin edits the home hero title; public reflects it.
  const tok = await adminSession();
  const newTitle = `Edited hero ${Date.now()}`;
  const home = await api('GET', '/api/v1/site/pages/home');
  const nextContent = { ...home.j.content, heroTitle: newTitle };
  const save = await api('PUT', '/api/v1/site/admin/pages/home', tok, { content: nextContent });
  ok('admin saves a page', save.status === 200, `→ ${save.status}`);
  const after = await api('GET', '/api/v1/site/pages/home');
  ok('public reflects the edit', after.j?.content?.heroTitle === newTitle, after.j?.content?.heroTitle);

  // Unknown page cannot be created.
  const bad = await api('PUT', '/api/v1/site/admin/pages/nonsense', tok, { content: {} });
  ok('unknown page rejected (404)', bad.status === 404, `→ ${bad.status}`);

  // Reset restores the default copy.
  const reset = await api('POST', '/api/v1/site/admin/pages/home/reset', tok, {});
  ok('reset restores default', reset.status === 200 && reset.j?.content?.heroTitle && reset.j.content.heroTitle !== newTitle, reset.j?.content?.heroTitle);

  // Content depth: 20+ FAQs, a Terms page, and images on the Features page.
  const faqPage = await api('GET', '/api/v1/site/pages/faq');
  ok('FAQ has at least 20 questions', (faqPage.j?.content?.items ?? []).length >= 20, `→ ${(faqPage.j?.content?.items ?? []).length}`);
  const terms = await api('GET', '/api/v1/site/pages/terms');
  ok('Terms & Conditions page exists with sections', terms.status === 200 && (terms.j?.content?.sections ?? []).length >= 5);
  const feats = await api('GET', '/api/v1/site/pages/features');
  ok('Features sections carry images', (feats.j?.content?.sections ?? []).every((s: any) => !!s.image) && (feats.j?.content?.sections ?? []).length >= 6);
  const footerLinks = (await api('GET', '/api/v1/site/pages/global')).j?.content?.footerLinks ?? [];
  ok('footer has Privacy + Terms links', footerLinks.some((l: any) => /privacy/i.test(l.label)) && footerLinks.some((l: any) => /terms/i.test(l.label)));

  // Public pricing: live from the admin-managed plans; only ACTIVE plans show.
  const pricing = await api('GET', '/api/v1/site/plans');
  ok('public plans list is served (CORS-open)', pricing.status === 200 && Array.isArray(pricing.j?.plans) && pricing.headers.get('access-control-allow-origin') === '*');
  ok('plans carry price + features', (pricing.j?.plans ?? []).every((p: any) => typeof p.netAmount === 'number' && Array.isArray(p.features)));
  // Admin creates an INACTIVE plan → it must NOT appear publicly; activate → it appears.
  const pkey = `sitetest${Date.now()}`;
  await api('POST', '/api/v1/billing/admin/plans', tok, { key: pkey, name: 'Site Test Plan', amount: 1234, active: false, modules: ['vault'] });
  const hidden = await api('GET', '/api/v1/site/plans');
  ok('inactive plan is hidden from the pricing page', !(hidden.j?.plans ?? []).some((p: any) => p.key === pkey));
  await api('POST', '/api/v1/billing/admin/plans', tok, { key: pkey, name: 'Site Test Plan', amount: 1234, active: true, modules: ['vault'] });
  const shown = await api('GET', '/api/v1/site/plans');
  ok('activated plan appears on the pricing page', (shown.j?.plans ?? []).some((p: any) => p.key === pkey && p.netAmount === 1234));

  // Global content exposes the socials + subscribe + popup blocks (editable in CMS).
  const global = await api('GET', '/api/v1/site/pages/global');
  ok('global content has socials + subscribe + popup', !!global.j?.content?.socials && !!global.j?.content?.subscribe && !!global.j?.content?.popup);

  // Public waitlist sign-up (no auth) is captured.
  const subEmail = `wait+${Date.now()}@example.com`;
  const sub = await api('POST', '/api/v1/site/subscribe', undefined, { name: 'Jo Bloggs', email: subEmail, notifyAtLaunch: true, source: 'website' });
  ok('public can join the waitlist', sub.status === 201 && sub.j?.ok === true, `→ ${sub.status}`);
  const dup = await api('POST', '/api/v1/site/subscribe', undefined, { name: 'Jo Bloggs', email: subEmail });
  ok('duplicate email is idempotent (no error)', dup.status === 201, `→ ${dup.status}`);
  const badEmail = await api('POST', '/api/v1/site/subscribe', undefined, { name: 'X', email: 'not-an-email' });
  ok('invalid email rejected (422)', badEmail.status === 422, `→ ${badEmail.status}`);

  // Admin sees the captured subscriber; non-admin cannot.
  const list = await api('GET', '/api/v1/site/admin/subscribers', tok);
  ok('admin lists subscribers', list.status === 200 && (list.j?.subscribers ?? []).some((s: any) => s.email === subEmail), `→ ${list.status}`);
  const uForbidden = await api('GET', '/api/v1/site/admin/subscribers', utok);
  ok('non-admin cannot read the waitlist (403)', uForbidden.status === 403, `→ ${uForbidden.status}`);

  // Contact page is a form (no email/phone/address fields; has form placeholders + image).
  const contact = await api('GET', '/api/v1/site/pages/contact');
  const cc = contact.j?.content ?? {};
  ok('contact page is a form (no email/phone/address)', !cc.email && !cc.phone && !cc.address && !!cc.button && !!cc.messagePlaceholder && !!cc.image, JSON.stringify(Object.keys(cc)));

  // About page renamed to "About Us" and has BOTH an "About Us" and an "About Vaulmo" section.
  const about = await api('GET', '/api/v1/site/pages/about');
  const aHeads = (about.j?.content?.sections ?? []).map((s: any) => s.heading);
  ok('about page titled "About Us"', about.j?.title === 'About Us' && about.j?.content?.title === 'About Us', about.j?.title);
  ok('about has "About Us" AND "About Vaulmo" sections', aHeads.includes('About Us') && aHeads.includes('About Vaulmo'), JSON.stringify(aHeads));
  ok('about + plans carry a header image', !!about.j?.content?.image && !!(await api('GET', '/api/v1/site/pages/plans')).j?.content?.image);

  // Nav/footer now say "About Us".
  const g2 = (await api('GET', '/api/v1/site/pages/global')).j?.content ?? {};
  ok('nav + footer label is "About Us"', (g2.nav ?? []).some((n: any) => n.label === 'About Us') && (g2.footerLinks ?? []).some((n: any) => n.label === 'About Us'));

  // Public contact-form submission is captured; validation enforced.
  const cName = 'Contact Tester', cEmail = `contact+${Date.now()}@example.com`, cMsg = 'Please get in touch about pricing.';
  const cSub = await api('POST', '/api/v1/site/contact', undefined, { name: cName, email: cEmail, subject: 'Pricing', message: cMsg, source: 'website' });
  ok('public can submit the contact form (201)', cSub.status === 201 && cSub.j?.ok === true, `→ ${cSub.status}`);
  const cBad = await api('POST', '/api/v1/site/contact', undefined, { name: 'X', email: 'nope', message: '' });
  ok('invalid contact submission rejected (422)', cBad.status === 422, `→ ${cBad.status}`);

  // Admin inbox: message appears, is unread, marks read; non-admin blocked.
  const inbox = await api('GET', '/api/v1/site/admin/messages', tok);
  const mine = (inbox.j?.messages ?? []).find((m: any) => m.email === cEmail);
  ok('admin inbox lists the message', inbox.status === 200 && !!mine && mine.message === cMsg && mine.status === 'new', `→ ${inbox.status}`);
  ok('inbox reports an unread count', typeof inbox.j?.unread === 'number' && inbox.j.unread >= 1, `→ ${inbox.j?.unread}`);
  const mRead = await api('POST', `/api/v1/site/admin/messages/${mine?.id}/read`, tok, {});
  ok('admin can mark a message read', mRead.status === 200 && mRead.j?.message?.status === 'read', `→ ${mRead.status}`);
  const mForbidden = await api('GET', '/api/v1/site/admin/messages', utok);
  ok('non-admin cannot read the inbox (403)', mForbidden.status === 403, `→ ${mForbidden.status}`);

  // Contact page label is "Contact Us"; global exposes logo/favicon + a socials on/off switch.
  const contactPg = await api('GET', '/api/v1/site/pages/contact');
  ok('contact page titled "Contact Us"', contactPg.j?.title === 'Contact Us' && contactPg.j?.content?.title === 'Contact Us', contactPg.j?.title);
  const gc = (await api('GET', '/api/v1/site/pages/global')).j?.content ?? {};
  ok('nav + footer say "Contact Us"', (gc.nav ?? []).some((n: any) => n.label === 'Contact Us') && (gc.footerLinks ?? []).some((n: any) => n.label === 'Contact Us'));
  ok('global exposes brandLogo, favicon + showSocials toggle', 'brandLogo' in gc && 'favicon' in gc && typeof gc.showSocials === 'boolean');

  // Admin-defined plan features are surfaced verbatim on the public pricing page.
  const fkey = `feat${Date.now()}`;
  const planFeats = ['Everything in Starter', 'Unlimited documents', 'Priority support'];
  await api('POST', '/api/v1/billing/admin/plans', tok, { key: fkey, name: 'Feature Test Plan', amount: 4900, active: true, modules: ['vault'], features: planFeats });
  const pricing2 = await api('GET', '/api/v1/site/plans');
  const fp = (pricing2.j?.plans ?? []).find((p: any) => p.key === fkey);
  ok('plan features match the admin-defined list exactly', !!fp && JSON.stringify(fp.features) === JSON.stringify(planFeats), JSON.stringify(fp?.features));
  // A plan with no explicit features still derives them from its modules (fallback).
  const dkey = `deriv${Date.now()}`;
  await api('POST', '/api/v1/billing/admin/plans', tok, { key: dkey, name: 'Derived Plan', amount: 100, active: true, modules: ['vault', 'passwords'], features: [] });
  const dp = (await api('GET', '/api/v1/site/plans')).j?.plans?.find((p: any) => p.key === dkey);
  ok('plan without explicit features falls back to modules', !!dp && dp.features.length >= 2, JSON.stringify(dp?.features));

  console.log(`\n  RESULT: ${pass} passed, ${fail} failed\n`);
  server.close(); await pool.end(); process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
