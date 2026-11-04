import { prisma } from '../../config/db.config';
import { CustomerProfile } from '@prisma/client';
import { CustomerProfileInput } from './customers.types';

export class CustomersRepository {
  public async findByUserId(userId: bigint): Promise<CustomerProfile | null> {
    return prisma.customerProfile.findUnique({
      where: { userId },
    });
  }

  public async upsertProfile(
    userId: bigint,
    data: CustomerProfileInput
  ): Promise<CustomerProfile> {
    const dob = data.dateOfBirth ? new Date(data.dateOfBirth) : null;

    return prisma.customerProfile.upsert({
      where: { userId },
      update: {
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        dateOfBirth: dob,
        gender: data.gender ?? null,
        profileImageUrl: data.profileImageUrl ?? null,
        updatedAt: new Date(),
      },
      create: {
        userId,
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        dateOfBirth: dob,
        gender: data.gender ?? null,
        profileImageUrl: data.profileImageUrl ?? null,
      },
    });
  }

  public async updateProfile(
    userId: bigint,
    data: Partial<CustomerProfileInput>
  ): Promise<CustomerProfile> {
    const dob = data.dateOfBirth !== undefined
      ? data.dateOfBirth ? new Date(data.dateOfBirth) : null
      : undefined;

    return prisma.customerProfile.update({
      where: { userId },
      data: {
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
        ...(dob !== undefined ? { dateOfBirth: dob } : {}),
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
        ...(data.profileImageUrl !== undefined
          ? { profileImageUrl: data.profileImageUrl }
          : {}),
        updatedAt: new Date(),
      },
    });
  }
}

export const customersRepository = new CustomersRepository();

