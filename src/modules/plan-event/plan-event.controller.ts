import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlanEventService } from './plan-event.service';
import { CreatePlanEventDto } from './dto/create-plan-event.dto';
import { UpdatePlanEventDto } from './dto/update-plan-event.dto';
import { QueryPlanEventDto } from './dto/query-plan-event.dto';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('event')
@UseGuards(RolesGuard)
export class PlanEventController {
  constructor(private readonly planEventService: PlanEventService) {}

  @Post('createEvent')
  @Roles(Role.ORGANIZER, Role.ADMIN)
  createEvent(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanEventDto) {
    return this.planEventService.create(user.userId, dto);
  }

  /** Public catalogue with pagination + filtering. */
  @Public()
  @PublicCache(60, 300)
  @Get('getAllEvents')
  getAllEvents(@Query() query: QueryPlanEventDto) {
    return this.planEventService.findAll(query);
  }

  @Public()
  @PublicCache(60, 300)
  @Get('getEventById/:id')
  getEventById(@Param('id') id: string) {
    return this.planEventService.findOne(id);
  }

  @Patch('updateEvent/:id')
  @Roles(Role.ORGANIZER, Role.ADMIN)
  updateEvent(
    @Param('id') id: string,
    @Body() dto: UpdatePlanEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.planEventService.update(id, dto, user);
  }

  @Delete('deleteEvent/:id')
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEvent(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.planEventService.remove(id, user);
  }
}
