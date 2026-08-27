import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Email delivery seam for support replies.
 *
 * It reads the mail settings the app already declares (`mail.*`, from SMTP_HOST
 * and friends) rather than introducing a second set of email config — there is
 * one mail configuration in this codebase and this uses it.
 *
 * No provider is wired today: `mail.host` is unset, notifications are in-app
 * only, and the OTP flow ships the same way (see SmsProvider). Rather than
 * pretend a reply was emailed, this reports honestly. The reply is always
 * persisted, and a signed-in customer always gets it as a real in-app
 * notification; `ContactRequest.responseEmailed` records whether mail actually
 * went out, and the admin console shows that distinction.
 *
 * To go live: set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / MAIL_FROM
 * (all already validated at boot) and implement sendViaProvider() with a mail
 * client. Nothing else in the feature has to change.
 */
@Injectable()
export class SupportMailProvider {
  private readonly logger = new Logger(SupportMailProvider.name);

  constructor(private readonly config: ConfigService) {}

  /** True only when the message genuinely left the system. */
  async sendResponse(to: string, subject: string, body: string): Promise<boolean> {
    const host = this.config.get<string>('mail.host');
    if (host) {
      return this.sendViaProvider(to, subject, body);
    }
    this.logger.warn(
      `[support-mail][stub] reply to ${to} ("${subject}") was saved but not emailed — SMTP_HOST is not set.`,
    );
    return false;
  }

  private async sendViaProvider(to: string, subject: string, body: string): Promise<boolean> {
    // const from = this.config.get<string>('mail.from');
    // TODO: real SMTP send once a mail client is added to the project.
    this.logger.error(
      `SMTP_HOST is configured but no mail client is wired yet. Would have emailed "${subject}" to ${to} (${body.length} chars).`,
    );
    return false;
  }
}
