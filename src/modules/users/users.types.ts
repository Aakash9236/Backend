export interface UpdateUserInput {
  email?: string;
}

export interface CreateAddressInput {
  cityId: string | number;
  areaId?: string | number | null;
  addressType?: 'HOME' | 'WORK' | 'OTHER';
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  postalCode: string;
  latitude: number;
  longitude: number;
  isDefault?: boolean;
}

export interface UpdateAddressInput {
  cityId?: string | number;
  areaId?: string | number | null;
  addressType?: 'HOME' | 'WORK' | 'OTHER';
  addressLine1?: string;
  addressLine2?: string | null;
  landmark?: string | null;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

