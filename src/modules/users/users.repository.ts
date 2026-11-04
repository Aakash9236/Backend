import { prisma } from '../../config/db.config';
import { User, UserAddress } from '@prisma/client';
import { CreateAddressInput, UpdateAddressInput } from './users.types';

export class UsersRepository {
  /**
   * Find user with roles, customer profile, and partner profile
   */
  public async findUserByIdWithDetails(userId: bigint) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: true },
        },
        customerProfile: true,
        partnerProfile: true,
      },
    });
  }

  /**
   * Update allowed basic user info
   */
  public async updateUser(userId: bigint, data: { email?: string }): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.email !== undefined ? { email: data.email } : {}),
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Safely deactivates user account and terminates all sessions
   */
  public async deactivateUser(userId: bigint): Promise<void> {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          accountStatus: 'DELETED',
          updatedAt: new Date(),
        },
      }),
      prisma.userSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);
  }

  /**
   * Verify city exists and is active
   */
  public async findCityById(cityId: bigint) {
    return prisma.city.findFirst({
      where: { id: cityId, isActive: true },
    });
  }

  /**
   * Verify area exists, is active, and belongs to the city
   */
  public async findAreaByIdAndCity(areaId: bigint, cityId: bigint) {
    return prisma.area.findFirst({
      where: { id: areaId, cityId, isActive: true },
    });
  }

  /**
   * Create an address for a user (atomic default address unsetting if isDefault = true)
   */
  public async createAddress(
    userId: bigint,
    data: CreateAddressInput
  ): Promise<UserAddress> {
    const cityId = BigInt(data.cityId);
    const areaId = data.areaId ? BigInt(data.areaId) : null;
    const isDefault = !!data.isDefault;

    return prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.userAddress.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.userAddress.create({
        data: {
          userId,
          cityId,
          areaId,
          addressType: data.addressType || 'HOME',
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2 || null,
          landmark: data.landmark || null,
          postalCode: data.postalCode,
          latitude: data.latitude,
          longitude: data.longitude,
          isDefault,
        },
        include: {
          city: true,
          area: true,
        },
      });
    });
  }

  /**
   * Find all addresses for user
   */
  public async findAddressesByUserId(userId: bigint): Promise<UserAddress[]> {
    return prisma.userAddress.findMany({
      where: { userId },
      include: {
        city: true,
        area: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Find specific address for a user
   */
  public async findAddressByIdAndUser(
    addressId: bigint,
    userId: bigint
  ): Promise<UserAddress | null> {
    return prisma.userAddress.findFirst({
      where: { id: addressId, userId },
      include: {
        city: true,
        area: true,
      },
    });
  }

  /**
   * Update address (atomic default handling if updated to default)
   */
  public async updateAddress(
    addressId: bigint,
    userId: bigint,
    data: UpdateAddressInput
  ): Promise<UserAddress> {
    return prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.userAddress.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.userAddress.update({
        where: { id: addressId },
        data: {
          ...(data.cityId !== undefined ? { cityId: BigInt(data.cityId) } : {}),
          ...(data.areaId !== undefined
            ? { areaId: data.areaId ? BigInt(data.areaId) : null }
            : {}),
          ...(data.addressType !== undefined ? { addressType: data.addressType } : {}),
          ...(data.addressLine1 !== undefined ? { addressLine1: data.addressLine1 } : {}),
          ...(data.addressLine2 !== undefined ? { addressLine2: data.addressLine2 } : {}),
          ...(data.landmark !== undefined ? { landmark: data.landmark } : {}),
          ...(data.postalCode !== undefined ? { postalCode: data.postalCode } : {}),
          ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
          ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
          ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
          updatedAt: new Date(),
        },
        include: {
          city: true,
          area: true,
        },
      });
    });
  }

  /**
   * Delete address
   */
  public async deleteAddress(addressId: bigint): Promise<void> {
    await prisma.userAddress.delete({
      where: { id: addressId },
    });
  }

  /**
   * Check if address is referenced in bookings
   */
  public async countAddressBookings(addressId: bigint): Promise<number> {
    return prisma.booking.count({
      where: {
        OR: [{ pickupAddressId: addressId }, { dropAddressId: addressId }],
      },
    });
  }

  /**
   * Sets single address as default for the user
   */
  public async setDefaultAddress(
    addressId: bigint,
    userId: bigint
  ): Promise<UserAddress> {
    return prisma.$transaction(async (tx) => {
      // Unset previous defaults
      await tx.userAddress.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });

      // Set target address as default
      return tx.userAddress.update({
        where: { id: addressId },
        data: { isDefault: true, updatedAt: new Date() },
        include: {
          city: true,
          area: true,
        },
      });
    });
  }
}

export const usersRepository = new UsersRepository();

