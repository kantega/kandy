/**
 * Format a date string or timestamp to a localized date and time string
 * @param timestamp - Unix timestamp in seconds (as string)
 * @param locale - BCP 47 language tag (e.g., 'nb', 'en')
 * @returns Formatted date string
 */
export const formatDateTime = (timestamp: string, locale: string): string => {
  try {
    // Convert Unix timestamp (seconds) to milliseconds
    const timestampMs = parseInt(timestamp, 10) * 1000;
    const date = new Date(timestampMs);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return timestamp; // Return original if invalid
    }

    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (error) {
    console.error("Failed to format date:", error);
    return timestamp; // Fallback to original timestamp
  }
};

/** Monday 00:00 of the week containing `date`, in local time. */
const startOfWeek = (date: Date): Date => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const sinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - sinceMonday);
  return start;
};

const capitalizeFirst = (text: string, locale: string): string =>
  text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

/**
 * Timestamp for a list row: weekday and time inside the current Monday-based
 * week ("Tirsdag 14:30"), full date and time for anything older.
 *
 * @param timestamp - Unix timestamp in seconds (as string)
 * @param locale - BCP 47 language tag (e.g., 'nb', 'en')
 */
export const formatListTimestamp = (
  timestamp: string,
  locale: string,
): string => {
  try {
    const date = new Date(parseInt(timestamp, 10) * 1000);
    if (isNaN(date.getTime())) {
      return timestamp;
    }

    if (startOfWeek(date).getTime() !== startOfWeek(new Date()).getTime()) {
      return formatDateTime(timestamp, locale);
    }

    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: "long",
    }).format(date);
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
    return `${capitalizeFirst(weekday, locale)} ${time}`;
  } catch (error) {
    console.error("Failed to format timestamp:", error);
    return timestamp;
  }
};
