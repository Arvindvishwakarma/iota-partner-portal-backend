import { AdmissionStatus, LeadStatus } from './types';

export type PipelineMainStatus =
  | 'Not Connected Yet'
  | 'Contact In Progress'
  | 'Connected'
  | 'Demo In Progress'
  | 'Demo Done'
  | 'Registration In Progress'
  | 'Registration Done'
  | 'Joined'
  | 'Closed'
  | 'Cancelled';

export interface PipelineStageDefinition {
  mainStatus: PipelineMainStatus;
  subStatuses: readonly string[];
  dbLeadStatus: LeadStatus;
  dbAdmissionStatus?: AdmissionStatus;
}

export const PIPELINE_STAGES: readonly PipelineStageDefinition[] = [
  {
    mainStatus: 'Not Connected Yet',
    subStatuses: [],
    dbLeadStatus: LeadStatus.NEW
  },
  {
    mainStatus: 'Contact In Progress',
    subStatuses: [
      'No Answer',
      'Number Busy',
      'Switched Off',
      'Not Reachable',
      'Call Disconnected',
      'WhatsApp Message Sent',
      'Callback Requested'
    ],
    dbLeadStatus: LeadStatus.CONTACTED
  },
  {
    mainStatus: 'Connected',
    subStatuses: [
      'Interested',
      'Needs More Information',
      'Office Visit Scheduled',
      'Office Visit Done',
      'Follow-up Required',
      'Callback Scheduled',
      'Not Interested'
    ],
    dbLeadStatus: LeadStatus.CONNECTED
  },
  {
    mainStatus: 'Demo In Progress',
    subStatuses: [
      'Demo Booked',
      'Demo Rescheduled',
      'Demo Cancelled',
      'Demo Not Attended'
    ],
    dbLeadStatus: LeadStatus.OFFICE_VISIT_SCHEDULED
  },
  {
    mainStatus: 'Demo Done',
    subStatuses: [],
    dbLeadStatus: LeadStatus.DEMO_ATTENDED
  },
  {
    mainStatus: 'Registration In Progress',
    subStatuses: [],
    dbLeadStatus: LeadStatus.INTERESTED
  },
  {
    mainStatus: 'Registration Done',
    subStatuses: [],
    dbLeadStatus: LeadStatus.ADMISSION_CONFIRMED,
    dbAdmissionStatus: AdmissionStatus.PENDING_VERIFICATION
  },
  {
    mainStatus: 'Joined',
    subStatuses: [
      'Joined Online',
      'Joined Offline'
    ],
    dbLeadStatus: LeadStatus.ADMISSION_CONFIRMED,
    dbAdmissionStatus: AdmissionStatus.VERIFIED
  },
  {
    mainStatus: 'Closed',
    subStatuses: [
      'Not Interested',
      'Not Responding',
      'Unable to Contact',
      'Course Not Suitable',
      'Fee/Budget Issue',
      'Joined Another Institute',
      'Duplicate Enquiry',
      'Invalid Contact Details',
      'Other'
    ],
    dbLeadStatus: LeadStatus.LOST,
    dbAdmissionStatus: AdmissionStatus.REJECTED
  },
  {
    mainStatus: 'Cancelled',
    subStatuses: [
      'Registration Cancelled',
      'Admission Cancelled',
      'Payment Refund Requested',
      'Refund Under Process',
      'Refund Completed'
    ],
    dbLeadStatus: LeadStatus.INVALID_CONTACT,
    dbAdmissionStatus: AdmissionStatus.CANCELLED
  }
] as const;

const LEGACY_STAGE_ALIASES: Record<string, PipelineMainStatus> = {
  'demo scheduled': 'Demo In Progress',
  'demo completed': 'Demo Done',
  'registered': 'Registration Done',
  'admission confirmed': 'Joined',
  'closed – not converted': 'Closed',
  'closed - not converted': 'Closed'
};

export function findPipelineStage(mainStatus?: string | null): PipelineStageDefinition | undefined {
  const clean = (mainStatus || '').trim().toLowerCase();
  const canonical = LEGACY_STAGE_ALIASES[clean];
  if (canonical) {
    return PIPELINE_STAGES.find((s) => s.mainStatus === canonical);
  }
  return PIPELINE_STAGES.find((s) => s.mainStatus.toLowerCase() === clean);
}

export function deriveMainStatusFromLegacy(
  status: string,
  admissionStatus?: string | null
): PipelineMainStatus {
  const norm = (status || '').toUpperCase().trim();
  const adm = (admissionStatus || '').toUpperCase().trim();

  if (norm === 'JOINED' || adm === 'VERIFIED') return 'Joined';
  if (norm === 'CANCELLED' || norm === 'CANCELED' || adm === 'CANCELLED' || norm === 'INVALID_CONTACT' || norm === 'DUPLICATE_IGNORED') {
    return 'Cancelled';
  }
  if (norm === 'DROPOUT' || norm === 'DROPPED' || norm === 'LOST' || norm === 'NOT_INTERESTED' || adm === 'REFUNDED' || adm === 'REJECTED') {
    return 'Closed';
  }
  if (norm === 'REGISTRATION_DONE' || norm === 'ADMISSION_CONFIRMED' || adm === 'PENDING_VERIFICATION') {
    return 'Registration Done';
  }
  if (norm === 'INTERESTED') return 'Registration In Progress';
  if (norm === 'DEMO_DONE' || norm === 'DEMO_ATTENDED' || norm === 'OFFICE_VISIT_COMPLETED') return 'Demo Done';
  if (norm === 'DEMO_IN_PROGRESS' || norm === 'DEMO_SCHEDULED' || norm === 'OFFICE_VISIT_SCHEDULED') return 'Demo In Progress';
  if (norm === 'CONNECTED' || norm === 'COUNSELLING' || norm === 'FOLLOW_UP_REQUIRED') return 'Connected';
  if (norm === 'CONTACT_IN_PROGRESS' || norm === 'CONTACTED') return 'Contact In Progress';
  return 'Not Connected Yet';
}
