export interface CalendarExpiryEvaluation {
  isExpired: boolean;
  isExpiringSoon: boolean;
  daysRemaining: number;
  formattedExpiry: string | null;
  warning?: 'DOCUMENT_EXPIRING_SOON' | 'DOCUMENT_EXPIRED';
}

export class DateUtil {
  /**
   * Normalizes a Date or date string to midnight UTC of that calendar day.
   * This ensures pure calendar-day comparisons independent of sub-day timestamps or clock offsets.
   */
  public static toCalendarMidnight(dateInput: Date | string): Date {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date representation: ${dateInput}`);
    }
    // Extract calendar components (UTC)
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  }

  /**
   * Evaluates document calendar-day validity with zero grace period and 15-day warning.
   *
   * Business Rules:
   * 1. A document remains valid throughout its entire expiry calendar date (until 23:59:59.999).
   * 2. It becomes expired only when the calendar day has passed (today > expiryDate).
   * 3. Zero grace period applies.
   * 4. 15-day warning window: 0 <= daysRemaining <= 15.
   */
  public static evaluateCalendarExpiry(
    expiryDateInput: Date | string | null | undefined,
    currentDateInput: Date = new Date()
  ): CalendarExpiryEvaluation {
    if (!expiryDateInput) {
      return {
        isExpired: false,
        isExpiringSoon: false,
        daysRemaining: -1, // No expiry tracked (e.g. perpetual document)
        formattedExpiry: null,
      };
    }

    try {
      const expiryMidnight = this.toCalendarMidnight(expiryDateInput);
      const todayMidnight = this.toCalendarMidnight(currentDateInput);

      // Difference in full 24-hour calendar days
      const msPerDay = 24 * 60 * 60 * 1000;
      const diffMs = expiryMidnight.getTime() - todayMidnight.getTime();
      const calendarDaysRemaining = Math.round(diffMs / msPerDay);

      const formattedExpiry = expiryMidnight.toISOString().split('T')[0];

      // If calendarDaysRemaining < 0, the expiry date has concluded
      if (calendarDaysRemaining < 0) {
        return {
          isExpired: true,
          isExpiringSoon: false,
          daysRemaining: 0,
          formattedExpiry,
          warning: 'DOCUMENT_EXPIRED',
        };
      }

      // If 0 <= calendarDaysRemaining <= 15, it's valid but expiring soon
      const isExpiringSoon = calendarDaysRemaining <= 15;

      return {
        isExpired: false,
        isExpiringSoon,
        daysRemaining: calendarDaysRemaining,
        formattedExpiry,
        warning: isExpiringSoon ? 'DOCUMENT_EXPIRING_SOON' : undefined,
      };
    } catch {
      return {
        isExpired: true,
        isExpiringSoon: false,
        daysRemaining: 0,
        formattedExpiry: null,
        warning: 'DOCUMENT_EXPIRED',
      };
    }
  }

  /**
   * Normalizes Indian vehicle registration numbers (e.g. "mh-02-ab-1234" -> "MH02AB1234")
   */
  public static normalizeRegistrationNumber(rawReg: string): string {
    return rawReg ? rawReg.toUpperCase().replace(/[\s\-_]/g, '') : '';
  }
}

