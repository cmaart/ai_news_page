import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_CLAIM } from '../config/disclosure';
import { byNewest, isListed } from '../lib/articles';
import { withBase } from '../lib/url';

export async function GET(context: APIContext) {
  const articles = (await getCollection('articles')).filter(isListed).sort(byNewest);

  return rss({
    title: 'Neue Nachrichten',
    description: SITE_CLAIM,
    site: context.site!,
    items: articles.map((article) => ({
      title: article.data.title,
      description: article.data.description,
      pubDate: article.data.publishedAt!,
      link: withBase(`/artikel/${article.id}/`),
    })),
    customData: '<language>de-AT</language>',
  });
}
