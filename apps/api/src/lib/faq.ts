// In-app FAQ + support overview. Static content served publicly so it can be shown
// before and after sign-in. Kept here (not the CMS) so it ships with the app and is
// always available even before any admin content is created.

export interface FaqItem { q: string; a: string }
export interface FaqCategory { key: string; title: string; items: FaqItem[] }

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    key: 'getting_started', title: 'Getting started',
    items: [
      { q: 'What is Vaulmo?', a: 'Vaulmo is your personal life operating system — a secure vault for your important documents with reminders, smart search and an AI assistant that answers questions using only your own information.' },
      { q: 'How do I add a document?', a: 'Open your Vault and tap Add. You can take a photo, choose a file or image from your device, or paste text. Vaulmo reads the details automatically; you check them and confirm.' },
      { q: 'What does the completion score mean?', a: 'It’s a friendly measure of how complete your vault is against the documents recommended for your household. It’s there to help — never to pressure you. Anything you mark “not applicable” is excluded.' },
    ],
  },
  {
    key: 'documents', title: 'Documents & scanning',
    items: [
      { q: 'Can I upload files as well as scan?', a: 'Yes. You can take a photo, pick an image or PDF from your device, or paste text. All of them are stored and, where possible, read automatically.' },
      { q: 'What if Vaulmo doesn’t recognise a document?', a: 'You can pick the document type yourself and fill in the details manually before saving. Nothing is stored until you confirm.' },
      { q: 'Can I link a document to a person, car or property?', a: 'Yes — link a child’s passport to the child, or an insurance policy to a specific car or your home, from the Family and Property & Vehicles areas.' },
    ],
  },
  {
    key: 'security', title: 'Security & privacy',
    items: [
      { q: 'Can Vaulmo staff see my documents?', a: 'No. Your data is encrypted and access is strictly controlled — administrators do not casually access your vault contents. Any exceptional access is authorised, limited and audited.' },
      { q: 'How do I protect my account?', a: 'Turn on two-factor authentication in Settings, keep your password private, and review your signed-in devices and security activity in the Privacy & Security Centre.' },
      { q: 'Can I export or delete my data?', a: 'Yes. From the Privacy & Security Centre you can export a full copy of your data at any time, or request account deletion (which asks for your password to confirm).' },
    ],
  },
  {
    key: 'billing', title: 'Plans & billing',
    items: [
      { q: 'How do plans work?', a: 'Each plan unlocks different features and household size. You choose a plan during sign-up and can upgrade, downgrade or cancel any time from Plan & Billing.' },
      { q: 'What happens if I cancel?', a: 'Cancelling stops the renewal but keeps your access until the end of your current paid period — it’s never an immediate cut-off. Your documents are never deleted automatically.' },
    ],
  },
  {
    key: 'reminders', title: 'Reminders & AI',
    items: [
      { q: 'Where do reminders come from?', a: 'Vaulmo creates them automatically from dates it finds (passport expiry, MOT, insurance renewals) and you can add your own, set them to repeat, snooze or mark them done.' },
      { q: 'What can I ask the assistant?', a: 'Ask things like “when does my passport expire?” or “is my washing machine still under warranty?”. Answers come only from your own vault, with sources.' },
    ],
  },
];

export const SUPPORT = {
  intro: 'We’re here to help. Most questions are answered in the FAQ below; if you still need us, raise a support request and we’ll get back to you.',
  channels: [
    { icon: '💬', title: 'In-app support', detail: 'Raise a request from Support — we reply in the app and by email.' },
    { icon: '📚', title: 'Help Centre', detail: 'Step-by-step guides and articles for common tasks.' },
    { icon: '🔒', title: 'Security & privacy', detail: 'Manage your data, exports, consents and devices in the Privacy & Security Centre.' },
  ],
  responseTime: 'We aim to respond to support requests within 1 business day.',
};

export function faqPayload() {
  return { categories: FAQ_CATEGORIES, support: SUPPORT };
}
