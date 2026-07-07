import { Header } from '@nestjs/common';

/**
 * Sets an edge/browser-cacheable `Cache-Control` on a public, non-personalized
 * GET endpoint so a CDN or reverse proxy can serve repeat reads without hitting
 * the origin. Only use on `@Public()` routes that return global reference data
 * (never per-user responses).
 *
 * `stale-while-revalidate` lets caches serve a slightly stale copy while they
 * refresh in the background — smooth traffic, no origin spikes.
 */
export const PublicCache = (maxAge = 60, staleWhileRevalidate = 300) =>
  Header(
    'Cache-Control',
    `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
  );
