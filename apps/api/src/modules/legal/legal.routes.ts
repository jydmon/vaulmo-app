import { Router } from 'express';
import { LEGAL, legalSummary } from '../../lib/legal';
import { faqPayload } from '../../lib/faq';
import { AppError } from '../../middleware/error';

// Public legal documents — shown during onboarding (before and after sign-in) and in-app.
export const legalRouter = Router();

legalRouter.get('/', (_req, res) => {
  res.json({ documents: legalSummary() });
});

// Public FAQ + support overview (also mounted at /api/v1/faq via app.ts).
export const faqRouter = Router();
faqRouter.get('/', (_req, res) => { res.json(faqPayload()); });

legalRouter.get('/:key', (req, res) => {
  const doc = LEGAL[req.params.key];
  if (!doc) throw new AppError(404, 'not_found', 'Legal document not found');
  res.json({ document: doc });
});
