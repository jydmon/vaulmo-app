// Legal documents shown during onboarding (Terms of Business must be accepted before
// use) and in the app. Bump CURRENT_TERMS_VERSION when the Terms of Business change —
// users are then re-prompted to acknowledge the new version on next sign-in.
export const CURRENT_TERMS_VERSION = '2026-08-01';
export const CURRENT_PRIVACY_VERSION = '2026-08-01';

export interface LegalDoc { key: string; title: string; version: string; updated: string; body: string }

export const LEGAL: Record<string, LegalDoc> = {
  terms_of_business: {
    key: 'terms_of_business',
    title: 'Terms of Business',
    version: CURRENT_TERMS_VERSION,
    updated: '1 August 2026',
    body: [
      'These Terms of Business govern your use of Vaulmo, a personal life-organisation and document-vault service operated by Vaulmo Ltd ("we", "us"). By accepting these terms you agree to use Vaulmo lawfully and only for your own personal or household purposes.',
      'Your subscription. Access to Vaulmo requires an active subscription plan. Fees, renewal dates and what each plan includes are shown before you pay. You may cancel your renewal at any time and keep access until the end of your paid period.',
      'Your content. You retain ownership of every document, record and piece of information you add. You are responsible for the accuracy and lawfulness of what you upload, and for holding the rights to store it.',
      'Our role. Vaulmo helps you organise, find and stay on top of your information. We are not a legal, financial, tax or insurance adviser, and reminders and AI suggestions are aids, not professional advice.',
      'Security & access. We protect your data with encryption and strict access controls. Our staff, including administrators, do not casually access the contents of your vault; any exceptional access is authorised, limited and audited.',
      'Availability. We work to keep Vaulmo available and safe, but the service is provided "as is". We may update features and these terms; material changes to the Terms of Business will be notified and you will be asked to review and acknowledge them.',
      'Ending your use. You may close your account at any time. On closure we handle your data in line with our Privacy Policy and applicable law.',
    ].join('\n\n'),
  },
  terms_of_use: {
    key: 'terms_of_use',
    title: 'Terms of Use',
    version: CURRENT_TERMS_VERSION,
    updated: '1 August 2026',
    body: [
      'These Terms of Use set out the rules for interacting with the Vaulmo application.',
      'Acceptable use. Do not misuse Vaulmo: no unlawful content, no attempts to access other users’ data, no interference with the service or its security, and no automated scraping.',
      'Your account. Keep your credentials confidential, enable two-factor authentication where offered, and tell us promptly if you suspect unauthorised access.',
      'Fair use. Storage and processing are provided on a fair-use basis appropriate to your plan.',
      'Intellectual property. The Vaulmo software, brand and design are ours; your content remains yours.',
    ].join('\n\n'),
  },
  privacy_policy: {
    key: 'privacy_policy',
    title: 'Privacy Policy',
    version: CURRENT_PRIVACY_VERSION,
    updated: '1 August 2026',
    body: [
      'This Privacy Policy explains how Vaulmo Ltd handles your personal data. We are the data controller for the account and profile information you provide, and we process your vault contents on your behalf to deliver the service you ask for.',
      'What we process. Account details (name, email, phone, timezone), your subscription and billing status, the documents and records you add, and the metadata our AI extracts to help you organise and search.',
      'Why. To provide and secure the service, to send reminders and service messages, to process payments (via Stripe — we never store your card details), and to comply with law.',
      'Security. Data is encrypted in transit and at rest. Access to vault contents is restricted; administrators cannot casually view your documents, and exceptional access is authorised and audited.',
      'Your rights. You can access, export or request deletion of your data at any time from the Privacy & Security Centre, and manage your consents there.',
      'AI processing. To power classification, extraction, search and the assistant, your document contents are processed by our systems. This is done to deliver features you use, and answers are drawn only from your own data.',
      'Retention. We keep your data while your account is active and as required by law; expiry of a subscription never automatically deletes your documents.',
    ].join('\n\n'),
  },
};

export function legalSummary() {
  return Object.values(LEGAL).map((d) => ({ key: d.key, title: d.title, version: d.version, updated: d.updated }));
}
