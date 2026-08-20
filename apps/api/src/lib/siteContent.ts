// Marketing-site content (vaulmo.com), editable from the admin console CMS.
// Each page is stored by slug with a structured `content` object. These defaults seed
// the store and also act as the landing site's built-in fallback copy, so the site
// renders even before anything is edited (or if the API is briefly unreachable).

export interface SitePageSeed { slug: string; title: string; content: any }

export const SITE_PAGE_SLUGS = ['global', 'home', 'features', 'security', 'privacy', 'support', 'about', 'contact', 'faq'] as const;

export const DEFAULT_SITE_PAGES: SitePageSeed[] = [
  {
    slug: 'global',
    title: 'Global',
    content: {
      brand: 'Vaulmo',
      tagline: 'Your family’s document vault, locked down',
      appUrl: 'https://app.vaulmo.com',
      appStoreUrl: '#',
      googlePlayUrl: '#',
      nav: [
        { label: 'Features', href: '#/features' },
        { label: 'Security', href: '#/security' },
        { label: 'Privacy', href: '#/privacy' },
        { label: 'Support', href: '#/support' },
        { label: 'About', href: '#/about' },
        { label: 'FAQs', href: '#/faq' },
        { label: 'Contact', href: '#/contact' },
      ],
      footerNote: '© 2026 Vaulmo. All rights reserved.',
      footerLinks: [
        { label: 'Features', href: '#/features' },
        { label: 'Security', href: '#/security' },
        { label: 'Privacy', href: '#/privacy' },
        { label: 'Support', href: '#/support' },
        { label: 'About', href: '#/about' },
        { label: 'Contact', href: '#/contact' },
      ],
      // Social links — paste full URLs; each icon only shows when its link is set.
      socials: { instagram: '', twitter: '', facebook: '' },
      // Waitlist sign-up form (shown top & bottom, and inside the launch popup).
      subscribe: {
        title: 'Be first to know',
        subtitle: 'Join the waitlist and we’ll tell you the moment Vaulmo launches.',
        namePlaceholder: 'Your name',
        emailPlaceholder: 'you@example.com',
        notifyLabel: 'Notify me when you launch',
        button: 'Join the waitlist',
        success: 'You’re on the list — thank you! We’ll be in touch at launch.',
      },
      // Popup shown when someone taps Download / App Store / Google Play before launch.
      popup: {
        title: 'Vaulmo isn’t live just yet',
        body: 'We’re putting the finishing touches to the app. Leave your details and we’ll email you the moment it’s ready to download.',
      },
    },
  },
  {
    slug: 'home',
    title: 'Home',
    content: {
      heroPill: 'Bank-level encryption · Family-ready',
      heroTitle: 'Your family’s important documents,',
      heroTitleAccent: 'locked down.',
      heroLead: 'Vaulmo keeps passports, policies, warranties and wills secure, organised and always to hand — with smart scanning and reminders so nothing important ever slips.',
      heroNote: 'Coming soon to iOS & Android. Free to download.',
      featuresEyebrow: 'Everything in one place',
      featuresTitle: 'Built to keep life’s paperwork safe',
      featuresIntro: 'Snap a photo and Vaulmo reads the details, files it, and reminds you before anything expires.',
      features: [
        { title: 'Bank-level security', body: 'Documents are encrypted, protected by two-factor login, and only ever visible to you and the people you choose.' },
        { title: 'Smart scanning', body: 'Photograph a document and Vaulmo pulls out the key dates and details automatically — no typing.' },
        { title: 'Never miss a renewal', body: 'Passports, insurance, warranties, MOTs — get reminded in good time, only after you confirm the dates.' },
        { title: 'Family & next of kin', body: 'Share the right documents with your household, and nominate a trusted next of kin for emergencies.' },
      ],
      ctaEyebrow: 'Get started',
      ctaTitle: 'Bring your paperwork into one secure place',
      ctaIntro: 'Download Vaulmo and set up your family vault in minutes.',
    },
  },
  {
    slug: 'features',
    title: 'Features',
    content: {
      title: 'Everything Vaulmo does for you',
      intro: 'One secure home for the documents, dates and details your family relies on.',
      sections: [
        { heading: 'Scan & organise', body: 'Photograph or upload any document — passport, insurance, warranty, payslip — and Vaulmo reads the key details, files it in the right place, and makes it searchable in seconds.' },
        { heading: 'Renewals & reminders', body: 'Vaulmo tracks expiry and renewal dates across documents, MOT, tax, insurance, warranties and subscriptions, and reminds you in good time — grouped into one clear “what’s coming up” view.' },
        { heading: 'Ask Vaulmo', body: 'Ask plain-English questions like “when does my passport expire?” or “what renews in the next six months?” and get answers drawn only from your own vault.' },
        { heading: 'Family & emergency access', body: 'Keep your household’s documents together and nominate a trusted next of kin who can request access in an emergency — always with your approval.' },
        { heading: 'Password vault', body: 'Store passwords, cards and secure notes in an encrypted vault only you can open.' },
        { heading: 'Passport photos', body: 'Take a compliant passport photo in the app — Vaulmo whitens the background and crops it to size.' },
      ],
    },
  },
  {
    slug: 'security',
    title: 'Security',
    content: {
      title: 'Security you can trust with what matters most',
      intro: 'Vaulmo is built security-first, because it holds the documents that matter most.',
      points: [
        'Encryption at rest for your most sensitive data',
        'Two-factor authentication and device management',
        'Biometric app lock (Face ID / fingerprint) on mobile',
        'You decide who sees what — nothing is shared by default',
        'A full activity log of every action on your account',
        'Administrators cannot casually view your document contents',
      ],
      sections: [
        { heading: 'Encrypted storage', body: 'Sensitive data is encrypted at rest. Your passwords and secure notes are encrypted with strong, industry-standard encryption before they are ever stored.' },
        { heading: 'Strong authentication', body: 'Protect your account with two-factor authentication, review the devices signed in, and lock the mobile app behind Face ID or your fingerprint.' },
        { heading: 'Least-privilege access', body: 'Nothing is shared by default. Family members and next of kin only ever see what you explicitly allow, and emergency access requires your approval and is fully audited.' },
      ],
    },
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    content: {
      title: 'Privacy policy',
      updated: 'Last updated: August 2026',
      intro: 'Your documents are yours. This summary explains what we collect, why, and the control you have. It is written to be readable — the full legal policy is available in-app.',
      sections: [
        { heading: 'What we store', body: 'The documents and details you choose to add, plus the account information needed to run the service (name, email, and security settings). We do not sell your data.' },
        { heading: 'Why we process it', body: 'To provide the vault, extract document details you ask us to, send the reminders you set, and keep your account secure.' },
        { heading: 'Who can see it', body: 'Only you, and the people you explicitly grant access to. Staff cannot casually browse your document contents; any exceptional access is authorised and logged.' },
        { heading: 'Your rights', body: 'You can export your data or request deletion at any time from within the app. Contact us if you need help exercising your rights.' },
      ],
    },
  },
  {
    slug: 'support',
    title: 'Support',
    content: {
      title: 'Help & support',
      intro: 'We’re here to help you get the most out of Vaulmo.',
      channels: [
        { name: 'Email support', detail: 'support@vaulmo.com — we aim to reply within one business day.' },
        { name: 'In-app help', detail: 'Open the app and visit Help & FAQ for step-by-step guides and answers to common questions.' },
        { name: 'Status & updates', detail: 'We’ll post any service updates here and notify you in-app.' },
      ],
      note: 'Looking for quick answers? Check the FAQs page first — most questions are covered there.',
    },
  },
  {
    slug: 'about',
    title: 'About',
    content: {
      title: 'About Vaulmo',
      intro: 'Vaulmo is a personal life operating system — a secure digital vault for your family’s most important documents, dates and details.',
      sections: [
        { heading: 'Why we built it', body: 'Life’s paperwork is scattered across drawers, inboxes and apps, and it’s easy to miss a renewal or lose something important. Vaulmo brings it all into one secure, organised place.' },
        { heading: 'What we believe', body: 'Your documents are private and should stay that way. We build security-first, put you in control of who sees what, and keep the experience simple enough for the whole family.' },
        { heading: 'Who it’s for', body: 'Households who want peace of mind that the important stuff is safe, in order, and there when they need it.' },
      ],
    },
  },
  {
    slug: 'contact',
    title: 'Contact',
    content: {
      title: 'Contact us',
      intro: 'Questions, feedback or press enquiries — we’d love to hear from you.',
      email: 'hello@vaulmo.com',
      supportEmail: 'support@vaulmo.com',
      phone: '',
      address: '',
      hours: 'Monday to Friday, 9am–5pm',
    },
  },
  {
    slug: 'faq',
    title: 'FAQs',
    content: {
      title: 'Frequently asked questions',
      intro: 'The short answers to the questions we hear most.',
      items: [
        { q: 'Is my data secure?', a: 'Yes. Sensitive data is encrypted, access is protected by two-factor authentication and an optional biometric lock, and nothing is shared without your say-so.' },
        { q: 'How does scanning work?', a: 'Photograph or upload a document and Vaulmo reads the key details automatically. You confirm what it found before anything is saved.' },
        { q: 'What does it cost?', a: 'Vaulmo is free to download. Subscription plans unlock additional features — you’ll always see the price and what’s included before you choose.' },
        { q: 'Can my family use it?', a: 'Yes. You can organise documents by household member and nominate a trusted next of kin for emergencies.' },
        { q: 'What happens in an emergency?', a: 'A nominated next of kin can request access. It only becomes active after your approval and a review, and even then it’s limited and time-boxed.' },
        { q: 'Which devices are supported?', a: 'Vaulmo works on the web and on iOS and Android, all signed in to the same account.' },
      ],
    },
  },
];

export const defaultForSlug = (slug: string): SitePageSeed | undefined => DEFAULT_SITE_PAGES.find((p) => p.slug === slug);
