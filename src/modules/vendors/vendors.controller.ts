import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgRole } from '../../../generated/prisma/enums';

@ApiTags('vendors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post()
  create(@Body() dto: CreateVendorDto) {
    return this.vendorsService.create(dto);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  listForOrganization(@Query('organizationId') organizationId: string) {
    return this.vendorsService.listForOrganization(organizationId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Delete(':vendorId')
  remove(@Param('vendorId') vendorId: string) {
    return this.vendorsService.remove(vendorId);
  }
}
