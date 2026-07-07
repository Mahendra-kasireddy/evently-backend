import { Controller, Get, Param } from '@nestjs/common';
import { PackageService } from './package.service';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';

@Controller('package')
export class PackageController {
  constructor(private readonly packageService: PackageService) {}

  /** Home "Curated packages by budget" carousel. */
  @Public()
  @PublicCache(60, 300)
  @Get('getPackages')
  getPackages() {
    return this.packageService.findActive();
  }

  /** Package detail ("Explore package"). */
  @Public()
  @PublicCache(60, 300)
  @Get('getPackageById/:id')
  getPackageById(@Param('id') id: string) {
    return this.packageService.findById(id);
  }
}
