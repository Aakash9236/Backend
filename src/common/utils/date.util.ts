export interface CalendarExpiryEvaluation {
  isExpired: boolean;
  isExpiringSoon: boolean;
  daysRemaining: number;
  formattedExpiry: string | null;
  warning?: 'DOCUMENT_EXPIRING_SOON' | 'DOCUMENT_EXPIRED';
  evaluatedInTimezone?: string;
  referenceDateInTimezone?: string;
}

export interface ParsedCalendarDate {
  year: number;
  month: number;
  day: number;
  dateStr: string;
}

export class DateUtil {
  /**
   * Business timezone for India marketplace platform operations.
   */
  public static readonly BUSINESS_TIMEZONE = 'Asia/Kolkata';

  /**
   * Formatter producing 'YYYY-MM-DD' strictly in the business timezone (Asia/Kolkata).
   * Independent of server/OS host local timezone settings.
   */
  private static readonly kolkataDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: DateUtil.BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  /**
   * Parses a Date object, ISO timestamp, or date string into calendar date components (year, month, day)
   * explicitly evaluated in Asia/Kolkata timezone.
   */
  public static parseCalendarDate(input: Date | string): ParsedCalendarDate {
    if (typeof input === 'string') {
      const trimmed = input.trim();
      // Date-only string (e.g. '2026-11-05') directly specifies the business calendar date
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const [y, m, d] = trimmed.split('-').map(Number);
        return { year: y, month: m, day: d, dateStr: trimmed };
      }
    }

    const dateObj = typeof input === 'string' ? new Date(input) : input;
    if (!dateObj || isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date representation: ${input}`);
    }

    const kolkataStr = this.kolkataDateFormatter.format(dateObj);
    const [y, m, d] = kolkataStr.split('-').map(Number);
    return { year: y, month: m, day: d, dateStr: kolkataStr };
  }

  /**
   * Normalizes a Date or date string to midnight UTC of that calendar day.
   * This ensures pure calendar-day storage for PostgreSQL DATE columns.
   */
  public static toCalendarMidnight(dateInput: Date | string): Date {
    const parsed = this.parseCalendarDate(dateInput);
    return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0));
  }

  /**
   * Returns the exact UTC Instant when a business calendar date begins in Asia/Kolkata (00:00:00.000 IST).
   */
  public static getStartOfKolkataDay(dateInput: Date | string): Date {
    const parsed = this.parseCalendarDate(dateInput);
    // 00:00:00 IST is 18:30:00 UTC of previous day
    // UTC offset for Asia/Kolkata is +05:30 (19,800,000 ms)
    const utcMidnightEpoch = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0);
    return new Date(utcMidnightEpoch - 19800000);
  }

  /**
   * Returns the exact UTC Instant when a business calendar date concludes in Asia/Kolkata (23:59:59.999 IST).
   */
  public static getEndOfKolkataDay(dateInput: Date | string): Date {
    const start = this.getStartOfKolkataDay(dateInput);
    return new Date(start.getTime() + 86399999);
  }

  /**
   * Evaluates document calendar-day validity with zero grace period and 15-day warning
   * strictly in Asia/Kolkata business timezone.
   *
   * Business Rules:
   * 1. A document remains valid throughout its entire expiry calendar date in Asia/Kolkata (until 23:59:59.999 IST).
   * 2. It becomes expired immediately once the Asia/Kolkata calendar day transitions to the next day (00:00:00.000 IST).
   * 3. Zero-day grace period applies.
   * 4. 15-calendar-day warning window: 0 <= daysRemaining <= 15.
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
      const exp = this.parseCalendarDate(expiryDateInput);
      const cur = this.parseCalendarDate(currentDateInput);

      // Calendar day count since Unix epoch in Asia/Kolkata
      const expDays = Math.floor(Date.UTC(exp.year, exp.month - 1, exp.day) / 86400000);
      const curDays = Math.floor(Date.UTC(cur.year, cur.month - 1, cur.day) / 86400000);

      const daysRemaining = expDays - curDays;

      // If daysRemaining < 0, the calendar day has concluded in Asia/Kolkata
      if (daysRemaining < 0) {
        return {
          isExpired: true,
          isExpiringSoon: false,
          daysRemaining: 0,
          formattedExpiry: exp.dateStr,
          warning: 'DOCUMENT_EXPIRED',
          evaluatedInTimezone: DateUtil.BUSINESS_TIMEZONE,
          referenceDateInTimezone: cur.dateStr,
        };
      }

      // If 0 <= daysRemaining <= 15, document is valid but in warning window
      const isExpiringSoon = daysRemaining <= 15;

      return {
        isExpired: false,
        isExpiringSoon,
        daysRemaining,
        formattedExpiry: exp.dateStr,
        warning: isExpiringSoon ? 'DOCUMENT_EXPIRING_SOON' : undefined,
        evaluatedInTimezone: DateUtil.BUSINESS_TIMEZONE,
        referenceDateInTimezone: cur.dateStr,
      };
    } catch {
      return {
        isExpired: true,
        isExpiringSoon: false,
        daysRemaining: 0,
        formattedExpiry: null,
        warning: 'DOCUMENT_EXPIRED',
        evaluatedInTimezone: DateUtil.BUSINESS_TIMEZONE,
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
