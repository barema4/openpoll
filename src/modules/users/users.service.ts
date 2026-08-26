import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateUserDto } from './dto/update-user.dto';

const SELECT = {
  id: true,
  email: true,
  name: true,
  gatewayWalletId: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: SELECT,
    });
  }

  update(userId: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { gatewayWalletId: dto.gatewayWalletId },
      select: SELECT,
    });
  }
}
