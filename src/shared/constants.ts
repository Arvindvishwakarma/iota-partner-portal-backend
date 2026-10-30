/**
 * IOTA Academy Authorized Partner Portal - Shared Constants (Backend)
 */

import { LeadStatus } from './types';

export const APP_NAME = 'IOTA Authorized Partner Portal';
export const APP_ORGANIZATION = 'IOTA Academy';

export const INDIAN_PHONE_REGEX = /^\+91[6-9]\d{9}$/;
export const RAW_INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

export const ATTRIBUTION_WINDOW_DAYS = 60;
export const STUDENT_REFUND_WINDOW_DAYS = 14;
export const MAX_VISIT_PROXIMITY_METERS = 500;

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export const VALID_LEAD_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  [LeadStatus.NEW]: [
    LeadStatus.CONTACTED,
    LeadStatus.INVALID_CONTACT,
    LeadStatus.DUPLICATE_IGNORED
  ],
  [LeadStatus.CONTACTED]: [
    LeadStatus.CONNECTED,
    LeadStatus.FOLLOW_UP_REQUIRED,
    LeadStatus.NOT_INTERESTED,
    LeadStatus.INVALID_CONTACT
  ],
  [LeadStatus.CONNECTED]: [
    LeadStatus.INTERESTED,
    LeadStatus.NOT_INTERESTED,
    LeadStatus.FOLLOW_UP_REQUIRED,
    LeadStatus.OFFICE_VISIT_SCHEDULED,
    LeadStatus.DEMO_ATTENDED
  ],
  [LeadStatus.INTERESTED]: [
    LeadStatus.OFFICE_VISIT_SCHEDULED,
    LeadStatus.DEMO_ATTENDED,
    LeadStatus.FOLLOW_UP_REQUIRED,
    LeadStatus.ADMISSION_CONFIRMED,
    LeadStatus.LOST
  ],
  [LeadStatus.FOLLOW_UP_REQUIRED]: [
    LeadStatus.CONNECTED,
    LeadStatus.CONTACTED,
    LeadStatus.INTERESTED,
    LeadStatus.NOT_INTERESTED,
    LeadStatus.LOST
  ],
  [LeadStatus.OFFICE_VISIT_SCHEDULED]: [
    LeadStatus.OFFICE_VISIT_COMPLETED,
    LeadStatus.FOLLOW_UP_REQUIRED,
    LeadStatus.LOST
  ],
  [LeadStatus.OFFICE_VISIT_COMPLETED]: [
    LeadStatus.DEMO_ATTENDED,
    LeadStatus.ADMISSION_CONFIRMED,
    LeadStatus.FOLLOW_UP_REQUIRED,
    LeadStatus.LOST
  ],
  [LeadStatus.DEMO_ATTENDED]: [
    LeadStatus.ADMISSION_CONFIRMED,
    LeadStatus.FOLLOW_UP_REQUIRED,
    LeadStatus.NOT_INTERESTED,
    LeadStatus.LOST
  ],
  [LeadStatus.ADMISSION_CONFIRMED]: [],
  [LeadStatus.NOT_INTERESTED]: [LeadStatus.CONNECTED],
  [LeadStatus.LOST]: [LeadStatus.CONNECTED],
  [LeadStatus.INVALID_CONTACT]: [],
  [LeadStatus.DUPLICATE_IGNORED]: []
};

