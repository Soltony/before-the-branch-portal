import { startOfDay } from 'date-fns';

/**
 * Gets the current date for all loan calculations.
 * Returns the start of the current day (midnight) for consistent date comparisons.
 * 
 * @returns Date object representing the start of today
 */
export function getAsOfDate(): Date {
  return startOfDay(new Date());
}

/**
 * Gets the current date for server-side calculations.
 * This version is explicitly for server actions and API routes.
 */
export function getServerAsOfDate(): Date {
  return getAsOfDate();
}
