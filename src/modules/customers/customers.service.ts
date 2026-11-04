import { customersRepository, CustomersRepository } from './customers.repository';
import { CustomerProfileInput } from './customers.types';
import { NotFoundError } from '../../common/errors';

export class CustomersService {
  constructor(private repo: CustomersRepository = customersRepository) {}

  public async getProfile(userIdStr: string) {
    const userId = BigInt(userIdStr);
    const profile = await this.repo.findByUserId(userId);

    if (!profile) {
      throw new NotFoundError('Customer profile not found for this user.');
    }

    return this.serializeProfile(profile);
  }

  public async createOrUpdateProfile(userIdStr: string, input: CustomerProfileInput) {
    const userId = BigInt(userIdStr);
    const profile = await this.repo.upsertProfile(userId, input);
    return this.serializeProfile(profile);
  }

  public async updateProfile(userIdStr: string, input: Partial<CustomerProfileInput>) {
    const userId = BigInt(userIdStr);
    const existing = await this.repo.findByUserId(userId);

    if (!existing) {
      throw new NotFoundError('Customer profile not found. Please create a profile first.');
    }

    const updated = await this.repo.updateProfile(userId, input);
    return this.serializeProfile(updated);
  }

  private serializeProfile(profile: any) {
    return {
      id: profile.id.toString(),
      userId: profile.userId.toString(),
      firstName: profile.firstName,
      lastName: profile.lastName,
      dateOfBirth: profile.dateOfBirth
        ? profile.dateOfBirth.toISOString().split('T')[0]
        : null,
      gender: profile.gender,
      profileImageUrl: profile.profileImageUrl,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}

export const customersService = new CustomersService();

