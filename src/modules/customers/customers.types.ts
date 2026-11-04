export interface CustomerProfileInput {
  firstName: string;
  lastName?: string | null;
  dateOfBirth?: string | null; // YYYY-MM-DD
  gender?: string | null;
  profileImageUrl?: string | null;
}

