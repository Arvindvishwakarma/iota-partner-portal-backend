/**
 * IOTA Academy Authorized Partner Portal - Shared Types (Backend)
 */

export enum Role {
  ADMIN = 'ADMIN',
  COUNSELLOR = 'COUNSELLOR',
  SALES = 'SALES',
  PARTNER = 'PARTNER'
}

export enum PartnerCategory {
  COMPUTER_CENTER = 'COMPUTER_CENTER',
  COACHING_INSTITUTE = 'COACHING_INSTITUTE',
  LIBRARY = 'LIBRARY',
  HOSTEL = 'HOSTEL',
  EDUCATIONAL_INSTITUTE = 'EDUCATIONAL_INSTITUTE',
  BOOKSTORE_OR_CAFE = 'BOOKSTORE_OR_CAFE',
  OTHER = 'OTHER'
}

export enum PartnerStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE'
}

export enum PremisesStatus {
  UNASSIGNED = 'UNASSIGNED',
  ASSIGNED = 'ASSIGNED',
  VISITED = 'VISITED',
  PARTNER_ONBOARDED = 'PARTNER_ONBOARDED',
  NOT_INTERESTED = 'NOT_INTERESTED',
  INVALID_PREMISES = 'INVALID_PREMISES'
}

export enum VisitStatus {
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  INTERESTED = 'INTERESTED',
  NOT_INTERESTED = 'NOT_INTERESTED',
  FOLLOW_UP_REQUIRED = 'FOLLOW_UP_REQUIRED',
  PARTNER_ONBOARDED = 'PARTNER_ONBOARDED',
  INVALID_CONTACT = 'INVALID_CONTACT',
  CANCELLED = 'CANCELLED',
  AUTHORIZED_PERSON_NOT_AVAILABLE = 'AUTHORIZED_PERSON_NOT_AVAILABLE',
  RESCHEDULED = 'RESCHEDULED',
  PREMISES_CLOSED_TEMPORARY = 'PREMISES_CLOSED_TEMPORARY',
  PREMISES_CLOSED_PERMANENTLY = 'PREMISES_CLOSED_PERMANENTLY',
  WRONG_ADDRESS = 'WRONG_ADDRESS'
}

export enum LeadStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  CONNECTED = 'CONNECTED',
  INTERESTED = 'INTERESTED',
  NOT_INTERESTED = 'NOT_INTERESTED',
  FOLLOW_UP_REQUIRED = 'FOLLOW_UP_REQUIRED',
  OFFICE_VISIT_SCHEDULED = 'OFFICE_VISIT_SCHEDULED',
  OFFICE_VISIT_COMPLETED = 'OFFICE_VISIT_COMPLETED',
  DEMO_ATTENDED = 'DEMO_ATTENDED',
  ADMISSION_CONFIRMED = 'ADMISSION_CONFIRMED',
  LOST = 'LOST',
  INVALID_CONTACT = 'INVALID_CONTACT',
  DUPLICATE_IGNORED = 'DUPLICATE_IGNORED'
}

export enum LeadSource {
  PARTNER_QR = 'PARTNER_QR',
  PARTNER_LINK = 'PARTNER_LINK',
  DIRECT_WALK_IN = 'DIRECT_WALK_IN',
  WEBSITE_ORGANIC = 'WEBSITE_ORGANIC',
  FIELD_SALES = 'FIELD_SALES'
}

export enum LeadActivityType {
  STATUS_CHANGE = 'STATUS_CHANGE',
  NOTE_ADDED = 'NOTE_ADDED',
  PHONE_CALL = 'PHONE_CALL',
  WHATSAPP_MESSAGE = 'WHATSAPP_MESSAGE',
  OFFICE_VISIT_SCHEDULED = 'OFFICE_VISIT_SCHEDULED',
  DEMO_SCHEDULED = 'DEMO_SCHEDULED',
  COUNSELLOR_ASSIGNED = 'COUNSELLOR_ASSIGNED',
  COUNSELLOR_REASSIGNED = 'COUNSELLOR_REASSIGNED',
  ADMISSION_CLOSED = 'ADMISSION_CLOSED',
  SYSTEM_ATTRIBUTED = 'SYSTEM_ATTRIBUTED'
}

export enum AdmissionStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

export enum CommissionStatus {
  PENDING = 'PENDING',
  ELIGIBLE = 'ELIGIBLE',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  ON_HOLD = 'ON_HOLD',
  REVERSED = 'REVERSED'
}

export enum SettlementStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED'
}

export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  WHATSAPP = 'WHATSAPP',
  EMAIL = 'EMAIL'
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED'
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta;
}

export interface ApiFieldError {
  field: string;
  issue: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ApiFieldError[];
  };
}

export interface JwtUserPayload {
  userId: string;
  email: string;
  role: Role;
  partnerId?: string;
  sessionId?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  role: Role;
  isActive: boolean;
  avatarUrl?: string | null;
  partnerId?: string | null;
}

