import { z } from 'zod';

export const contactCategoryEnum = z.enum([
  'General Enquiry',
  'Affiliate Registration',
  'Affiliate Account',
  'Referral or Lead Tracking',
  'Earnings and Payments',
  'Technical Support',
  'Complaint or Grievance',
  'Other',
]);

export const contactMessageSchema = z.object({
  name: z
    .string({ required_error: 'Full name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name cannot exceed 100 characters'),
  email: z
    .string({ required_error: 'Email address is required' })
    .trim()
    .email('Please enter a valid email address')
    .max(100, 'Email cannot exceed 100 characters'),
  phone: z
    .string({ required_error: 'Mobile number is required' })
    .trim()
    .min(10, 'Mobile number must be at least 10 digits')
    .max(20, 'Mobile number cannot exceed 20 characters'),
  category: contactCategoryEnum,
  subject: z
    .string({ required_error: 'Subject is required' })
    .trim()
    .min(3, 'Subject must be at least 3 characters')
    .max(200, 'Subject cannot exceed 200 characters'),
  message: z
    .string({ required_error: 'Message is required' })
    .trim()
    .min(10, 'Message must be at least 10 characters')
    .max(3000, 'Message cannot exceed 3000 characters'),
});

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
