/**
 * The links and message text a share produces.
 *
 * One published invitation, one guest token, and a `section` query parameter —
 * never a second invitation record per section. The guest always lands on the
 * same document; the section only decides what is brought into view.
 */

import { waDigits } from './guest-phone';

/** Sections a share can point at. Anything else is treated as "the whole thing". */
export interface ShareTarget {
  /** A block key from the invitation, or '' for the complete invitation. */
  section: string;
  /** The section's own title, for the message text. */
  sectionLabel: string;
}

export interface ShareMessageInput {
  eventName: string;
  /** Who is hosting, when the invitation says. */
  hosts: string;
  target: ShareTarget;
  guestName: string;
  url: string;
  /** Optional store link; omitted entirely when not configured. */
  appLink?: string;
}

/**
 * The guest-facing URL.
 *
 * Points at the API's preview route rather than the SPA directly, because the
 * WhatsApp crawler does not run JavaScript and the SPA's `index.html` is a
 * single static shell — a link straight to the app can never produce a preview
 * card. The preview route serves the Open Graph tags and then sends the guest
 * on to the app.
 */
export function guestShareUrl(apiBaseUrl: string, token: string, section: string): string {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/invitation/shared/${encodeURIComponent(token)}/preview`;
  return section ? `${base}?section=${encodeURIComponent(section)}` : base;
}

/** Where the preview route sends a real browser: the app's own guest route. */
export function guestAppUrl(webBaseUrl: string, token: string, section: string): string {
  const base = `${webBaseUrl.replace(/\/+$/, '')}/i/${encodeURIComponent(token)}`;
  return section ? `${base}?section=${encodeURIComponent(section)}` : base;
}

/**
 * The WhatsApp message.
 *
 * Deliberately short: WhatsApp shows a preview card for the link, so repeating
 * the event's details in the body would say everything twice. The link is on
 * its own line because clients only linkify a bare URL reliably.
 */
export function shareMessage(input: ShareMessageInput): string {
  const { eventName, hosts, target, guestName, url, appLink } = input;

  const greeting = guestName ? `Hi ${guestName},` : 'Hi,';
  const what = target.section
    ? `${hosts || eventName} shared the ${target.sectionLabel.toLowerCase()} for ${eventName} with you.`
    : `${hosts || eventName} invited you to ${eventName}.`;

  const lines = [greeting, '', what, '', url, '', 'View the full invitation — no app needed.'];
  if (appLink) lines.push(`Get the Evently app: ${appLink}`);
  lines.push('', 'Sent with Evently');
  return lines.join('\n');
}

/**
 * A click-to-chat link that opens the customer's own WhatsApp with the message
 * and recipient already filled in.
 *
 * This is a handoff, not a send: the customer still presses send, and nothing
 * here can know whether the number has WhatsApp or whether the message was
 * ever delivered. That is why the stored status says "handed off".
 */
export function waMeUrl(e164: string, message: string): string {
  return `https://wa.me/${waDigits(e164)}?text=${encodeURIComponent(message)}`;
}
