import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReviewService } from './review.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { REVIEW_TAG_LABEL } from './schemas/review.schema';

@Controller('review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  /**
   * An organizer's reviews.
   *
   * Public, because the organizer's profile is: requiring a session to read
   * what people said about a business would only stop somebody deciding
   * whether to sign up. Nothing here identifies a reviewer beyond a first
   * name and an initial — see ReviewService.toPublicView.
   */
  @Public()
  @Get('organizer/:organizerId')
  listForOrganizer(@Param('organizerId') organizerId: string, @Query('page') page?: string) {
    return this.reviewService.listForOrganizer(organizerId, Number(page) || 1);
  }

  /** The score, the star breakdown and the tag counts. */
  @Public()
  @Get('organizer/:organizerId/summary')
  summaryForOrganizer(@Param('organizerId') organizerId: string) {
    return this.reviewService.summaryForOrganizer(organizerId);
  }

  /** The chips a customer can pick from, so the client never hardcodes them. */
  @Public()
  @Get('tags')
  tags() {
    return Object.entries(REVIEW_TAG_LABEL).map(([key, label]) => ({ key, label }));
  }

  /**
   * Whether this customer still owes a review for a booking of theirs — what
   * the workspace uses to decide whether to offer the prompt at all.
   */
  @Get('mine/:bookingId/can-review')
  canReview(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.reviewService.canReview(userId, bookingId);
  }

  /**
   * Leaves a review. The booking id is the only thing the caller names, and
   * the service checks they own it and that it is finished — the organizer,
   * occasion and date all come from the booking, never from the body.
   */
  @Post('mine/:bookingId')
  create(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewService.create(userId, bookingId, dto);
  }
}
