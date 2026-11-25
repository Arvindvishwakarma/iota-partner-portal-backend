import { PrismaClient, Role, PartnerCategory, AffiliateStatus, PremisesStatus, Gender, Occupation } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting IOTA Affiliate Program Database Seeding...');

  // Hash seed passwords
  const adminPasswordHash = await argon2.hash('Admin@IOTA2026!');
  const counsellorPasswordHash = await argon2.hash('Counsellor@IOTA2026!');
  const salesPasswordHash = await argon2.hash('Sales@IOTA2026!');
  const partnerPasswordHash = await argon2.hash('Partner@IOTA2026!');

  const officeAddress = '1st Floor, GB Tower, Opp. Veda Business Park, Bhawarkua, Indore 452001';

  // 1. Seed Super Admin
  const admin = await prisma.user.upsert({
    where: { emailAddress: 'admin@iotaacademy.in' },
    update: {},
    create: {
      firstName: 'IOTA',
      lastName: 'Administrator',
      role: Role.ADMIN,
      gender: Gender.Other,
      age: 30,
      mobileNumber: '+919800000001',
      whatsappNumber: '+919800000001',
      emailAddress: 'admin@iotaacademy.in',
      password: adminPasswordHash,
      occupation: Occupation.WORKING_PROFESSIONAL,
      communicationAddress: officeAddress,
      isActive: true
    }
  });
  console.log(`✅ Admin created: ${admin.emailAddress}`);

  // 2. Seed Academic Counselor
  const counsellor = await prisma.user.upsert({
    where: { emailAddress: 'counsellor@iotaacademy.in' },
    update: {},
    create: {
      firstName: 'Priya',
      lastName: 'Sharma',
      role: Role.COUNSELLOR,
      gender: Gender.Female,
      age: 28,
      mobileNumber: '+919800000002',
      whatsappNumber: '+919800000002',
      emailAddress: 'counsellor@iotaacademy.in',
      password: counsellorPasswordHash,
      occupation: Occupation.WORKING_PROFESSIONAL,
      communicationAddress: officeAddress,
      isActive: true
    }
  });
  console.log(`✅ Counselor created: ${counsellor.emailAddress}`);

  // 3. Business Development Executive
  const sales = await prisma.user.upsert({
    where: { emailAddress: 'sales@iotaacademy.in' },
    update: {},
    create: {
      firstName: 'Vikram',
      lastName: 'Singh',
      role: Role.SALES,
      gender: Gender.Male,
      age: 27,
      mobileNumber: '+919800000003',
      whatsappNumber: '+919800000003',
      emailAddress: 'sales@iotaacademy.in',
      password: salesPasswordHash,
      occupation: Occupation.WORKING_PROFESSIONAL,
      communicationAddress: officeAddress,
      isActive: true
    }
  });
  console.log(`✅ Sales Rep created: ${sales.emailAddress}`);

  // 4. Seed Master Courses
  const coursesData = [
    {
      code: 'DA-AI-01',
      name: 'Data Analytics with AI',
      description: 'Master data analysis, SQL, PowerBI, Python, and modern AI predictive tools.',
      feeAmount: 30000.0,
      durationWeeks: 16
    },
    {
      code: 'DS-AI-01',
      name: 'Data Science with AI',
      description: 'Comprehensive Python, Statistics, Machine Learning, Deep Learning, and Generative AI.',
      feeAmount: 40000.0,
      durationWeeks: 20
    },
    {
      code: 'BA-AI-01',
      name: 'Business Analytics with AI',
      description: 'Strategic business decision making, KPIs, advanced dashboards, and AI automation.',
      feeAmount: 32000.0,
      durationWeeks: 14
    },
    {
      code: 'ML-AI-01',
      name: 'Machine Learning with AI',
      description: 'Advanced supervised & unsupervised algorithms, PyTorch, TensorFlow, and AI model deployments.',
      feeAmount: 42000.0,
      durationWeeks: 18
    },
    {
      code: 'AI-AI-01',
      name: 'Artificial Intelligence with AI',
      description: 'Core artificial intelligence architectures, LLMs, prompt engineering, and autonomous agents.',
      feeAmount: 45000.0,
      durationWeeks: 20
    },
    {
      code: 'FSD-AI-01',
      name: 'Full Stack Development with AI',
      description: 'Full stack development with Next.js, Node.js, databases, and AI coding integration.',
      feeAmount: 35000.0,
      durationWeeks: 16
    },
    {
      code: 'GUIDANCE-01',
      name: 'Not sure yet - need guidance',
      description: 'Comprehensive curriculum counselling & personalized academic roadmap discussion.',
      feeAmount: 0.0,
      durationWeeks: 12
    }
  ];

  for (const course of coursesData) {
    await prisma.course.upsert({
      where: { code: course.code },
      update: {},
      create: course
    });
  }
  console.log('✅ Academic Courses seeded.');

  // 5. Seed Commission Rules
  const existingRules = await prisma.commissionRule.count();
  if (existingRules === 0) {
    await prisma.commissionRule.create({
      data: {
        ruleName: 'Default Standard Partner Commission',
        commissionType: 'FLAT',
        commissionValue: 1000.0,
        isActive: true
      }
    });
    console.log('✅ Default Commission Rule seeded.');
  }

  // 6. Seed Sample Authorized Affiliate
  const partnerUser = await prisma.user.upsert({
    where: { emailAddress: 'partner@iotaacademy.in' },
    update: {},
    create: {
      firstName: 'Suresh',
      lastName: 'Reddy',
      role: Role.AFFILIATE,
      gender: Gender.Male,
      age: 34,
      mobileNumber: '+919800000004',
      whatsappNumber: '+919800000004',
      emailAddress: 'partner@iotaacademy.in',
      password: partnerPasswordHash,
      occupation: Occupation.BUSINESS_OWNER,
      communicationAddress: officeAddress,
      isActive: true
    }
  });

  const existingPartner = await prisma.affiliate.findUnique({
    where: { userId: partnerUser.id }
  });

  if (!existingPartner) {
    await prisma.affiliate.create({
      data: {
        userId: partnerUser.id,
        affiliateCode: 'IAA00101',
        firstName: 'Suresh',
        lastName: 'Reddy',
        gender: Gender.Male,
        age: 34,
        mobileNumber: '+919800000004',
        whatsappNumber: '+919800000004',
        emailAddress: 'partner@iotaacademy.in',
        communicationAddress: officeAddress,
        city: 'Indore',
        state: 'Madhya Pradesh',
        pincode: '452001',
        occupation: Occupation.BUSINESS_OWNER,
        firmName: 'Apex Computer Education Hub',
        ownerBusinessType: 'Computer Center',
        status: AffiliateStatus.ACTIVE,
        registrationUrl: 'https://affiliate.iotaacademy.in/register/IAA00101',
        bankAccountHolderName: 'Apex Education Center',
        bankName: 'HDFC Bank',
        bankIfscNumber: 'HDFC0001234',
        bankAccountNumber: '89625451501234'
      }
    });
    console.log('✅ Sample Authorized Affiliate created: IAA00101');
  }

  // 7. Seed Sample Premises for Field Canvassing
  const existingPremises = await prisma.premises.count();
  if (existingPremises === 0) {
    await prisma.premises.createMany({
      data: [
        {
          premisesName: 'Indira Tech Academy & Library',
          category: PartnerCategory.LIBRARY,
          contactNumber: '+919811223344',
          website: 'https://indiratech.example.com',
          googleMapUrl: 'https://maps.google.com/?q=12.9784,77.6408',
          fullAddress: '',
          latitude: 12.9784,
          longitude: 77.6408,
          currentStatus: PremisesStatus.UNASSIGNED
        },
        {
          premisesName: 'Bright Future Coaching Hub',
          category: PartnerCategory.COACHING_INSTITUTE,
          contactNumber: '+919822334455',
          website: 'https://brightfuture.example.com',
          googleMapUrl: 'https://maps.google.com/?q=12.9352,77.6245',
          fullAddress: '#24, 80 Feet Road, 4th Block, Koramangala, Indore - 560034',
          latitude: 12.9352,
          longitude: 77.6245,
          currentStatus: PremisesStatus.UNASSIGNED
        }
      ]
    });
    console.log('✅ Sample Premises seeded.');
  }

  console.log('🎉 Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

