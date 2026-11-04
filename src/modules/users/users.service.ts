import { usersRepository, UsersRepository } from './users.repository';
import { CreateAddressInput, UpdateAddressInput, UpdateUserInput } from './users.types';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../common/errors';
import { logger } from '../../config/logger.config';

export class UsersService {
  constructor(private repo: UsersRepository = usersRepository) {}

  /**
   * Retrieve authenticated user profile with roles and profiles
   */
  public async getMe(userIdStr: string, activeRoleFromToken?: string) {
    const userId = BigInt(userIdStr);
    const user = await this.repo.findUserByIdWithDetails(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    if (user.accountStatus !== 'ACTIVE') {
      throw new ForbiddenError(
        `Account is ${user.accountStatus.toLowerCase()}. Access denied.`
      );
    }

    const assignedRoles = user.userRoles.map((ur) => ur.role.roleName);
    let activeRole = activeRoleFromToken;
    if (!activeRole || !assignedRoles.includes(activeRole)) {
      activeRole = assignedRoles.includes('CUSTOMER') ? 'CUSTOMER' : assignedRoles[0];
    }

    return {
      id: user.id.toString(),
      mobileNumber: user.mobileNumber,
      email: user.email,
      accountStatus: user.accountStatus,
      isMobileVerified: user.isMobileVerified,
      activeRole,
      roles: assignedRoles,
      customerProfile: user.customerProfile
        ? {
            id: user.customerProfile.id.toString(),
            firstName: user.customerProfile.firstName,
            lastName: user.customerProfile.lastName,
            dateOfBirth: user.customerProfile.dateOfBirth
              ? user.customerProfile.dateOfBirth.toISOString().split('T')[0]
              : null,
            gender: user.customerProfile.gender,
            profileImageUrl: user.customerProfile.profileImageUrl,
          }
        : null,
      partnerProfile: user.partnerProfile
        ? {
            id: user.partnerProfile.id.toString(),
            profileType: user.partnerProfile.profileType,
            legalName: user.partnerProfile.legalName,
            businessName: user.partnerProfile.businessName,
            approvalStatus: user.partnerProfile.approvalStatus,
          }
        : null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  /**
   * Update permitted user profile fields (e.g. email)
   */
  public async updateMe(userIdStr: string, input: UpdateUserInput) {
    const userId = BigInt(userIdStr);
    const user = await this.repo.findUserByIdWithDetails(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const updated = await this.repo.updateUser(userId, input);
    return {
      id: updated.id.toString(),
      mobileNumber: updated.mobileNumber,
      email: updated.email,
      accountStatus: updated.accountStatus,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Get roles held by authenticated user enriched with operational status and active context
   */
  public async getMyRoles(userIdStr: string, activeRoleFromToken?: string) {
    const userId = BigInt(userIdStr);
    const user = await this.repo.findUserByIdWithDetails(userId);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const assignedRoleNames = user.userRoles.map((ur) => ur.role.roleName);
    let resolvedActiveRole = activeRoleFromToken;
    if (!resolvedActiveRole || !assignedRoleNames.includes(resolvedActiveRole)) {
      resolvedActiveRole = assignedRoleNames.includes('CUSTOMER') ? 'CUSTOMER' : assignedRoleNames[0];
    }

    return user.userRoles.map((ur) => {
      let status = 'ACTIVE';
      let isOperational = false;

      if (ur.role.roleName === 'CUSTOMER') {
        status = user.accountStatus;
        isOperational = user.accountStatus === 'ACTIVE';
      } else if (ur.role.roleName === 'PARTNER') {
        if (user.partnerProfile) {
          status = user.partnerProfile.approvalStatus;
          isOperational = user.partnerProfile.approvalStatus === 'APPROVED';
        } else {
          status = 'UNREGISTERED';
          isOperational = false;
        }
      } else if (ur.role.roleName === 'DRIVER' || ur.role.roleName === 'WORKER') {
        status = 'NOT_ONBOARDED';
        isOperational = false;
      } else if (ur.role.roleName === 'ADMIN' || ur.role.roleName === 'SUPER_ADMIN') {
        status = 'ACTIVE';
        isOperational = true;
      }

      return {
        roleName: ur.role.roleName,
        description: ur.role.description,
        assignedAt: ur.assignedAt.toISOString(),
        status,
        isOperational,
        isActiveContext: ur.role.roleName === resolvedActiveRole,
      };
    });
  }

  /**
   * Safely deactivates user account and invalidates all sessions
   */
  public async deactivateMe(userIdStr: string) {
    const userId = BigInt(userIdStr);
    logger.info(`[User Deactivation] Request to deactivate account for user: ${userIdStr}`);
    await this.repo.deactivateUser(userId);
    return { deactivated: true };
  }

  /**
   * Create an address with city and optional area validation
   */
  public async createAddress(userIdStr: string, input: CreateAddressInput) {
    const userId = BigInt(userIdStr);
    const cityId = BigInt(input.cityId);

    // 1. Verify city exists and is active
    const city = await this.repo.findCityById(cityId);
    if (!city) {
      throw new BadRequestError('Specified city is invalid or inactive.');
    }

    // 2. Verify area exists and belongs to the specified city if provided
    if (input.areaId) {
      const areaId = BigInt(input.areaId);
      const area = await this.repo.findAreaByIdAndCity(areaId, cityId);
      if (!area) {
        throw new BadRequestError('Specified area does not exist within the specified city.');
      }
    }

    const address = await this.repo.createAddress(userId, input);
    return this.serializeAddress(address);
  }

  /**
   * Get all addresses belonging to the user
   */
  public async getAddresses(userIdStr: string) {
    const userId = BigInt(userIdStr);
    const addresses = await this.repo.findAddressesByUserId(userId);
    return addresses.map((addr) => this.serializeAddress(addr));
  }

  /**
   * Get specific address for user
   */
  public async getAddressById(userIdStr: string, addressIdStr: string) {
    const userId = BigInt(userIdStr);
    const addressId = BigInt(addressIdStr);
    const address = await this.repo.findAddressByIdAndUser(addressId, userId);

    if (!address) {
      throw new NotFoundError('Address not found or does not belong to you.');
    }

    return this.serializeAddress(address);
  }

  /**
   * Update address
   */
  public async updateAddress(
    userIdStr: string,
    addressIdStr: string,
    input: UpdateAddressInput
  ) {
    const userId = BigInt(userIdStr);
    const addressId = BigInt(addressIdStr);

    const existing = await this.repo.findAddressByIdAndUser(addressId, userId);
    if (!existing) {
      throw new NotFoundError('Address not found or does not belong to you.');
    }

    const cityId = input.cityId ? BigInt(input.cityId) : existing.cityId;
    if (input.cityId) {
      const city = await this.repo.findCityById(cityId);
      if (!city) {
        throw new BadRequestError('Specified city is invalid or inactive.');
      }
    }

    if (input.areaId) {
      const areaId = BigInt(input.areaId);
      const area = await this.repo.findAreaByIdAndCity(areaId, cityId);
      if (!area) {
        throw new BadRequestError('Specified area does not exist within the city.');
      }
    }

    const updated = await this.repo.updateAddress(addressId, userId, input);
    return this.serializeAddress(updated);
  }

  /**
   * Delete address (verifies ownership and protects booking references)
   */
  public async deleteAddress(userIdStr: string, addressIdStr: string) {
    const userId = BigInt(userIdStr);
    const addressId = BigInt(addressIdStr);

    const existing = await this.repo.findAddressByIdAndUser(addressId, userId);
    if (!existing) {
      throw new NotFoundError('Address not found or does not belong to you.');
    }

    // Check if address is linked to existing bookings
    const bookingCount = await this.repo.countAddressBookings(addressId);
    if (bookingCount > 0) {
      throw new BadRequestError(
        'Address cannot be deleted because it is associated with historical bookings.'
      );
    }

    await this.repo.deleteAddress(addressId);
    return { deleted: true };
  }

  /**
   * Set specific address as default
   */
  public async setDefaultAddress(userIdStr: string, addressIdStr: string) {
    const userId = BigInt(userIdStr);
    const addressId = BigInt(addressIdStr);

    const existing = await this.repo.findAddressByIdAndUser(addressId, userId);
    if (!existing) {
      throw new NotFoundError('Address not found or does not belong to you.');
    }

    const updated = await this.repo.setDefaultAddress(addressId, userId);
    return this.serializeAddress(updated);
  }

  private serializeAddress(addr: any) {
    return {
      id: addr.id.toString(),
      userId: addr.userId.toString(),
      cityId: addr.cityId.toString(),
      areaId: addr.areaId ? addr.areaId.toString() : null,
      cityName: addr.city ? addr.city.cityName : undefined,
      areaName: addr.area ? addr.area.areaName : undefined,
      addressType: addr.addressType,
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2,
      landmark: addr.landmark,
      postalCode: addr.postalCode,
      latitude: Number(addr.latitude),
      longitude: Number(addr.longitude),
      isDefault: addr.isDefault,
      createdAt: addr.createdAt.toISOString(),
      updatedAt: addr.updatedAt.toISOString(),
    };
  }
}

export const usersService = new UsersService();

