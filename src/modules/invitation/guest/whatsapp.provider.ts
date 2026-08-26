import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShareStatus } from '../schemas/invitation-guest.schema';
import { waMeUrl } from './share-links';

/**
 * WhatsApp delivery seam, shaped after `auth/providers/sms.provider.ts` so the
 * project has one pattern for "an outbound channel that may not be configured".
 *
 * Two modes:
 *
 *  - `handoff` (default): builds a wa.me click-to-chat link. The customer's own
 *    WhatsApp opens with the recipient and message filled in and they press
 *    send. No Meta account, no cost, no template approval — and no delivery
 *    receipt, which is why the recorded status is HANDED_OFF.
 *
 *  - `cloud`: a real POST to the WhatsApp Cloud API. This needs a Meta business
 *    account, a WhatsApp Business Account, a phone number id, a permanent
 *    access token, and a *pre-approved template* — a business-initiated message
 *    outside a 24-hour service window cannot be free-form text. Without all of
 *    those the call fails and this reports FAILED. It never reports a success
 *    it did not get.
 */
export type WhatsAppMode = 'handoff' | 'cloud';

export interface WhatsAppSendResult {
  status: ShareStatus;
  /** Present in handoff mode: the link the client must open to finish the send. */
  handoffUrl?: string;
  providerMessageId?: string;
  error?: string;
}

/** The Graph API's shape, narrowed to what is actually read. */
interface CloudApiResponse {
  messages?: { id?: string }[];
  error?: { message?: string; code?: number; error_subcode?: number };
}

@Injectable()
export class WhatsAppProvider {
  private readonly logger = new Logger(WhatsAppProvider.name);

  constructor(private readonly config: ConfigService) {}

  get mode(): WhatsAppMode {
    return this.config.get<string>('whatsapp.delivery') === 'cloud' ? 'cloud' : 'handoff';
  }

  /**
   * `templateParams` carries the values a Cloud template's placeholders take,
   * in order. Handoff mode ignores it and sends `message` verbatim, which is
   * why both are passed: the two channels genuinely accept different payloads.
   */
  async send(
    toE164: string,
    message: string,
    templateParams: string[],
  ): Promise<WhatsAppSendResult> {
    if (this.mode === 'handoff') {
      return { status: ShareStatus.HANDED_OFF, handoffUrl: waMeUrl(toE164, message) };
    }
    return this.sendViaCloudApi(toE164, templateParams);
  }

  private async sendViaCloudApi(
    toE164: string,
    templateParams: string[],
  ): Promise<WhatsAppSendResult> {
    const phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    const accessToken = this.config.get<string>('whatsapp.accessToken');
    const template = this.config.get<string>('whatsapp.templateName');
    const language = this.config.get<string>('whatsapp.templateLanguage') ?? 'en';
    const version = this.config.get<string>('whatsapp.graphVersion') ?? 'v21.0';

    const missing = [
      !phoneNumberId && 'WHATSAPP_PHONE_NUMBER_ID',
      !accessToken && 'WHATSAPP_ACCESS_TOKEN',
      !template && 'WHATSAPP_TEMPLATE_NAME',
    ].filter(Boolean);

    if (missing.length > 0) {
      // Loud and specific: a silent fallback to handoff would look like it
      // worked while quietly not being the channel that was configured.
      const error = `WHATSAPP_DELIVERY=cloud but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not set`;
      this.logger.error(error);
      return { status: ShareStatus.FAILED, error };
    }

    const body = {
      messaging_product: 'whatsapp',
      to: toE164.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template,
        language: { code: language },
        components: [
          {
            type: 'body',
            parameters: templateParams.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    };

    try {
      const response = await fetch(
        `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as CloudApiResponse;

      if (!response.ok) {
        // Meta's message, not ours — but never the token, which is only ever
        // in the request header.
        const error = payload.error?.message ?? `WhatsApp API returned ${response.status}`;
        this.logger.error(`WhatsApp send failed: ${error}`);
        return { status: ShareStatus.FAILED, error };
      }

      const id = payload.messages?.[0]?.id ?? '';
      return { status: ShareStatus.SENT, providerMessageId: id };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'WhatsApp request failed';
      this.logger.error(`WhatsApp send failed: ${error}`);
      return { status: ShareStatus.FAILED, error };
    }
  }
}
