import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { cmsArticles } from '../../db/schema';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../middleware/error';

// Customer-facing knowledge base. Only PUBLISHED articles are ever exposed here;
// drafts stay inside the admin CMS. Available to any authenticated user.
export const cmsRouter = Router();
cmsRouter.use(requireAuth);

cmsRouter.get('/articles', async (_req, res) => {
  const rows = await db
    .select({ id: cmsArticles.id, slug: cmsArticles.slug, title: cmsArticles.title, category: cmsArticles.category, excerpt: cmsArticles.excerpt, publishedAt: cmsArticles.publishedAt })
    .from(cmsArticles)
    .where(eq(cmsArticles.status, 'published'))
    .orderBy(desc(cmsArticles.publishedAt));
  res.json({ articles: rows });
});

cmsRouter.get('/articles/:slug', async (req, res) => {
  const [a] = await db.select().from(cmsArticles).where(and(eq(cmsArticles.slug, req.params.slug), eq(cmsArticles.status, 'published'))).limit(1);
  if (!a) throw new AppError(404, 'not_found', 'Article not found');
  await db.update(cmsArticles).set({ views: sql`${cmsArticles.views} + 1` }).where(eq(cmsArticles.id, a.id));
  res.json({ article: { id: a.id, slug: a.slug, title: a.title, category: a.category, excerpt: a.excerpt, body: a.body, publishedAt: a.publishedAt } });
});
