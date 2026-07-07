import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument, BookingStatus } from './schemas/booking.schema';

/** Shape consumed by the home "BOOKED" card (matches frontend BookedEventData). */
export interface ActiveBookingView {
  ref: string;
  title: string;
  description: string;
  progress: number;
  daysToGo: number;
  steps: { label: string; done: boolean }[];
}

@Injectable()
export class BookingService {
  constructor(@InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>) {}

  /**
   * The signed-in customer's current active booking, shaped for the home card.
   * Returns null when the customer has no active booking (card stays hidden).
   */
  async getActiveForUser(userId: string): Promise<ActiveBookingView | null> {
    const booking = await this.bookingModel
      .findOne({ customer: userId, status: BookingStatus.ACTIVE })
      .sort({ createdAt: -1 })
      .exec();

    if (!booking) return null;

    return {
      ref: booking.ref,
      title: booking.title,
      description: booking.description,
      progress: booking.progress,
      daysToGo: this.daysUntil(booking.eventDate),
      steps: booking.steps,
    };
  }

  private daysUntil(date: Date): number {
    const ms = date.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }
}
