import { z } from 'zod';
import { Occupation } from '../shared';
import { toCapitalCase } from './public-partner.validator';

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_REGEX = /^\d{6}$/;

/**
 * Verhoeff algorithm checksum validation for 12-digit Indian Aadhaar numbers.
 */
export function isValidAadhaarVerhoeff(aadhaar: string): boolean {
  if (!/^[2-9]\d{11}$/.test(aadhaar)) return false;

  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];

  let c = 0;
  const digits = aadhaar.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = d[c][p[i % 8][digits[i]]];
  }
  return c === 0;
}

export const submitKycSchema = z
  .object({
    // 1. Personal Details
    fullLegalName: z
      .string({ required_error: 'Full Legal Name is required' })
      .trim()
      .min(2, 'Full Legal Name must be at least 2 characters')
      .max(150)
      .transform((v) => toCapitalCase(v)),
    dob: z
      .string({ required_error: 'Date of Birth is required' })
      .trim()
      .refine((v) => !isNaN(Date.parse(v)), { message: 'Please enter a valid Date of Birth' })
      .refine((v) => {
        const birth = new Date(v);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age >= 18 && age < 100;
      }, { message: 'Affiliate must be at least 18 years old' }),
    avatarUrl: z.string({ required_error: 'Profile Picture is required' }).trim().min(1, 'Profile Picture is required'),
    permanentAddress: z.string({ required_error: 'Permanent Address is required' }).trim().min(3).max(500),
    permanentCity: z
      .string({ required_error: 'Permanent City is required' })
      .trim()
      .min(2)
      .max(80)
      .transform((v) => toCapitalCase(v)),
    permanentState: z.string({ required_error: 'Permanent State is required' }).trim().min(2).max(80),
    permanentPincode: z.string({ required_error: 'Permanent Pincode is required' }).trim().regex(PINCODE_REGEX, 'Permanent Pincode must be 6 digits'),
    communicationAddress: z.string({ required_error: 'Communication Address is required' }).trim().min(3).max(500),
    city: z
      .string({ required_error: 'City is required' })
      .trim()
      .min(2)
      .max(80)
      .transform((v) => toCapitalCase(v)),
    state: z.string({ required_error: 'State is required' }).trim().min(2).max(80),
    pincode: z.string({ required_error: 'Pincode is required' }).trim().regex(PINCODE_REGEX, 'Communication Pincode must be 6 digits'),

    // 2. Identity Verification
    identityProofType: z.enum(['Aadhaar Card', 'PAN Card']),
    aadharCardNumber: z.string().trim().optional().nullable(),
    aadharCardFrontUrl: z.string().trim().optional().nullable(),
    aadharCardBackUrl: z.string().trim().optional().nullable(),
    panCardNumber: z
      .string({ required_error: 'PAN Card Number is required' })
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => PAN_REGEX.test(v), { message: 'PAN Number must be in ABCDE1234F format' }),
    panCardFrontUrl: z.string().trim().optional().nullable(),
    panCardBackUrl: z.string().trim().optional().nullable(),

    // 3. Occupation Details
    occupation: z.nativeEnum(Occupation),
    firmName: z.string().trim().max(150).optional().nullable(),
    ownerBusinessType: z.string().trim().max(100).optional().nullable(),
    firmAddress: z.string().trim().max(500).optional().nullable(),
    firmCity: z.string().trim().max(80).optional().nullable(),
    firmState: z.string().trim().max(80).optional().nullable(),
    firmPincode: z.string().trim().optional().nullable(),

    studentCollegeName: z.string().trim().max(150).optional().nullable(),
    studentCollegeDegree: z.string().trim().max(100).optional().nullable(),
    studentCollegeYearSemester: z.string().trim().max(50).optional().nullable(),
    studentCollegeAddress: z.string().trim().max(500).optional().nullable(),
    studentCollegeCity: z.string().trim().max(80).optional().nullable(),
    studentCollegeState: z.string().trim().max(80).optional().nullable(),
    studentCollegePincode: z.string().trim().optional().nullable(),

    professionalCompanyName: z.string().trim().max(150).optional().nullable(),
    professionalJobTitle: z.string().trim().max(100).optional().nullable(),
    professionalCompanyAddress: z.string().trim().max(500).optional().nullable(),
    professionalCompanyCity: z.string().trim().max(80).optional().nullable(),
    professionalCompanyState: z.string().trim().max(80).optional().nullable(),
    professionalCompanyPincode: z.string().trim().optional().nullable(),

    educatorInstituteType: z.string().trim().max(80).optional().nullable(),
    educatorInstituteName: z.string().trim().max(150).optional().nullable(),
    educatorDesignation: z.string().trim().max(100).optional().nullable(),
    educatorInstituteAddress: z.string().trim().max(500).optional().nullable(),
    educatorInstituteCity: z.string().trim().max(80).optional().nullable(),
    educatorInstituteState: z.string().trim().max(80).optional().nullable(),
    educatorInstitutePincode: z.string().trim().optional().nullable(),

    freelancerWorkCategory: z.string().trim().max(100).optional().nullable(),
    freelancerDescribeWork: z.string().trim().max(1000).optional().nullable(),

    otherOccupationName: z.string().trim().max(150).optional().nullable(),
    otherOccupationDescribe: z.string().trim().max(1000).optional().nullable(),
    otherOccupationAddress: z.string().trim().max(500).optional().nullable(),
    otherOccupationCity: z.string().trim().max(80).optional().nullable(),
    otherOccupationState: z.string().trim().max(80).optional().nullable(),
    otherOccupationPincode: z.string().trim().optional().nullable(),

    selfEmployedOccupationName: z.string().trim().max(150).optional().nullable(),
    selfEmployedOccupationDescribe: z.string().trim().max(1000).optional().nullable(),
    selfEmployedOccupationAddress: z.string().trim().max(500).optional().nullable(),
    selfEmployedOccupationCity: z.string().trim().max(80).optional().nullable(),
    selfEmployedOccupationState: z.string().trim().max(80).optional().nullable(),
    selfEmployedOccupationPincode: z.string().trim().optional().nullable(),

    // 4. Bank & Payout Details
    preferredPaymentMethod: z.string().trim().min(1).max(30).default('Bank Transfer'),
    bankAccountHolderName: z
      .string({ required_error: 'Account Holder Name is required' })
      .trim()
      .min(2)
      .max(150),
    bankAccountNumber: z
      .string({ required_error: 'Account Number is required' })
      .trim()
      .regex(/^[A-Za-z0-9]{6,30}$/, 'Account Number must be 6 to 30 alphanumeric characters'),
    confirmAccountNumber: z.string({ required_error: 'Please confirm your Account Number' }).trim(),
    bankIfscNumber: z
      .string({ required_error: 'IFSC Code is required' })
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => IFSC_REGEX.test(v), { message: 'IFSC Code must be 11 characters (e.g. SBIN0001234)' }),
    bankName: z.string({ required_error: 'Bank Name is required' }).trim().min(2).max(100),
    bankProof: z.string({ required_error: 'Cancelled Cheque / Bank Proof is required' }).trim().min(1, 'Bank proof upload is required')
  })
  .superRefine((data, ctx) => {
    if (data.bankAccountNumber !== data.confirmAccountNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmAccountNumber'],
        message: 'Account numbers do not match'
      });
    }

    if (data.identityProofType === 'Aadhaar Card') {
      const cleanAadhaar = (data.aadharCardNumber || '').replace(/\s+/g, '');
      if (!isValidAadhaarVerhoeff(cleanAadhaar)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['aadharCardNumber'],
          message: 'Please enter a valid 12-digit Aadhaar number'
        });
      }
      if (!data.aadharCardFrontUrl?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['aadharCardFrontUrl'], message: 'Aadhaar front image is required' });
      }
      if (!data.aadharCardBackUrl?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['aadharCardBackUrl'], message: 'Aadhaar back image is required' });
      }
    } else if (data.identityProofType === 'PAN Card') {
      if (!data.panCardFrontUrl?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['panCardFrontUrl'], message: 'PAN Card image is required' });
      }
    }

    const req = (val: string | null | undefined, path: string, msg: string) => {
      if (!val?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: msg });
      }
    };
    const reqPin = (val: string | null | undefined, path: string, label: string) => {
      if (!val?.trim() || !PINCODE_REGEX.test(val.trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${label} must be 6 digits` });
      }
    };

    switch (data.occupation) {
      case Occupation.BUSINESS_OWNER:
        req(data.firmName, 'firmName', 'Firm Name is required');
        req(data.ownerBusinessType, 'ownerBusinessType', 'Business Type is required');
        req(data.firmAddress, 'firmAddress', 'Firm Address is required');
        req(data.firmCity, 'firmCity', 'Firm City is required');
        req(data.firmState, 'firmState', 'Firm State is required');
        reqPin(data.firmPincode, 'firmPincode', 'Firm Pincode');
        break;

      case Occupation.STUDENT:
        req(data.studentCollegeName, 'studentCollegeName', 'College Name is required');
        req(data.studentCollegeDegree, 'studentCollegeDegree', 'Degree is required');
        req(data.studentCollegeYearSemester, 'studentCollegeYearSemester', 'Current Year / Semester is required');
        req(data.studentCollegeAddress, 'studentCollegeAddress', 'College Address is required');
        req(data.studentCollegeCity, 'studentCollegeCity', 'College City is required');
        req(data.studentCollegeState, 'studentCollegeState', 'College State is required');
        reqPin(data.studentCollegePincode, 'studentCollegePincode', 'College Pincode');
        break;

      case Occupation.WORKING_PROFESSIONAL:
        req(data.professionalCompanyName, 'professionalCompanyName', 'Company Name is required');
        req(data.professionalJobTitle, 'professionalJobTitle', 'Job Title / Designation is required');
        req(data.professionalCompanyAddress, 'professionalCompanyAddress', 'Company Address is required');
        req(data.professionalCompanyCity, 'professionalCompanyCity', 'Company City is required');
        req(data.professionalCompanyState, 'professionalCompanyState', 'Company State is required');
        reqPin(data.professionalCompanyPincode, 'professionalCompanyPincode', 'Company Pincode');
        break;

      case Occupation.EDUCATOR:
        req(data.educatorInstituteType, 'educatorInstituteType', 'Institution Type is required');
        req(data.educatorInstituteName, 'educatorInstituteName', 'Institute Name is required');
        req(data.educatorDesignation, 'educatorDesignation', 'Designation is required');
        req(data.educatorInstituteAddress, 'educatorInstituteAddress', 'Institute Address is required');
        req(data.educatorInstituteCity, 'educatorInstituteCity', 'Institute City is required');
        req(data.educatorInstituteState, 'educatorInstituteState', 'Institute State is required');
        reqPin(data.educatorInstitutePincode, 'educatorInstitutePincode', 'Institute Pincode');
        break;

      case Occupation.FREELANCER:
        req(data.freelancerWorkCategory, 'freelancerWorkCategory', 'Work Category is required');
        break;

      case Occupation.CONSULTANT:
        req(data.firmName, 'firmName', 'Firm Name is required');
        req(data.firmAddress, 'firmAddress', 'Firm Address is required');
        req(data.firmCity, 'firmCity', 'Firm City is required');
        req(data.firmState, 'firmState', 'Firm State is required');
        reqPin(data.firmPincode, 'firmPincode', 'Firm Pincode');
        break;

      case Occupation.OTHER:
        req(data.otherOccupationName, 'otherOccupationName', 'Occupation Name is required');
        req(data.otherOccupationDescribe, 'otherOccupationDescribe', 'Brief Description is required');
        req(data.otherOccupationAddress, 'otherOccupationAddress', 'Occupation Address is required');
        req(data.otherOccupationCity, 'otherOccupationCity', 'Occupation City is required');
        req(data.otherOccupationState, 'otherOccupationState', 'Occupation State is required');
        reqPin(data.otherOccupationPincode, 'otherOccupationPincode', 'Occupation Pincode');
        break;

      case Occupation.SELF_EMPLOYED:
        req(data.selfEmployedOccupationName, 'selfEmployedOccupationName', 'Occupation Name is required');
        req(data.selfEmployedOccupationDescribe, 'selfEmployedOccupationDescribe', 'Brief Description is required');
        req(data.selfEmployedOccupationAddress, 'selfEmployedOccupationAddress', 'Occupation Address is required');
        req(data.selfEmployedOccupationCity, 'selfEmployedOccupationCity', 'Occupation City is required');
        req(data.selfEmployedOccupationState, 'selfEmployedOccupationState', 'Occupation State is required');
        reqPin(data.selfEmployedOccupationPincode, 'selfEmployedOccupationPincode', 'Occupation Pincode');
        break;

      case Occupation.INFLUENCER:
      default:
        break;
    }
  });

export type SubmitKycInput = z.infer<typeof submitKycSchema>;
