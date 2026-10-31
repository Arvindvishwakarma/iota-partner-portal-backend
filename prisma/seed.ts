import { PrismaClient, Role, PartnerCategory, PartnerStatus, PremisesStatus } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting IOTA Authorized Partner Portal Database Seeding...');

  // Hash seed passwords
  const adminPasswordHash = await argon2.hash('Admin@IOTA2026!');
  const counsellorPasswordHash = await argon2.hash('Counsellor@IOTA2026!');
  const salesPasswordHash = await argon2.hash('Sales@IOTA2026!');
  const partnerPasswordHash = await argon2.hash('Partner@IOTA2026!');

  // 1. Seed Super Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@iotaacademy.in' },
    update: {},
    create: {
      email: 'admin@iotaacademy.in',
      passwordHash: adminPasswordHash,
      fullName: 'IOTA Super Administrator',
      phone: '+919800000001',
      role: Role.ADMIN,
      isActive: true
    }
  });
  console.log(`✅ Admin created: ${admin.email}`);

  // 2. Seed Academic Counselor
  const counsellor = await prisma.user.upsert({
    where: { email: 'counsellor@iotaacademy.in' },
    update: {},
    create: {
      email: 'counsellor@iotaacademy.in',
      passwordHash: counsellorPasswordHash,
      fullName: 'Priya Sharma (Senior Counselor)',
      phone: '+919800000002',
      role: Role.COUNSELLOR,
      isActive: true
    }
  });
  console.log(`✅ Counselor created: ${counsellor.email}`);

  // 3. Seed Field Sales Representative
  const sales = await prisma.user.upsert({
    where: { email: 'sales@iotaacademy.in' },
    update: {},
    create: {
      email: 'sales@iotaacademy.in',
      passwordHash: salesPasswordHash,
      fullName: 'Vikram Singh (Field Sales)',
      phone: '+919800000003',
      role: Role.SALES,
      isActive: true
    }
  });
  console.log(`✅ Sales Rep created: ${sales.email}`);

  // 4. Seed Master Courses
  const coursesData = [
    {
      code: 'FSWD-01',
      name: 'Full Stack Web Development (MERN)',
      description: 'Comprehensive industry program covering React, Node.js, Next.js, and cloud deployments.',
      feeAmount: 35000.0,
      durationWeeks: 16
    },
    {
      code: 'DSML-01',
      name: 'Data Science & Machine Learning Pro',
      description: 'Hands-on Python, SQL, Statistics, Scikit-learn, and Generative AI fundamentals.',
      feeAmount: 45000.0,
      durationWeeks: 20
    },
    {
      code: 'PYFS-01',
      name: 'Python Full Stack Developer',
      description: 'Core & Advanced Python, Django, PostgreSQL, and RESTful Microservices.',
      feeAmount: 25000.0,
      durationWeeks: 12
    },
    {
      code: 'DMGM-01',
      name: 'Digital Marketing & Growth Mastery',
      description: 'SEO, Performance Marketing, Meta/Google Ads, Analytics, and Conversion Optimization.',
      feeAmount: 20000.0,
      durationWeeks: 10
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

  // 6. Seed Sample Authorized Partner
  const partnerUser = await prisma.user.upsert({
    where: { email: 'partner@iotaacademy.in' },
    update: {},
    create: {
      email: 'partner@iotaacademy.in',
      passwordHash: partnerPasswordHash,
      fullName: 'Suresh Reddy (Center Director)',
      phone: '+919800000004',
      role: Role.PARTNER,
      isActive: true
    }
  });

  const existingPartner = await prisma.partner.findUnique({
    where: { userId: partnerUser.id }
  });

  if (!existingPartner) {
    await prisma.partner.create({
      data: {
        userId: partnerUser.id,
        partnerCode: 'PTR-BLR-0001',
        businessName: 'Apex Computer Education Hub',
        category: PartnerCategory.COMPUTER_CENTER,
        ownerName: 'Suresh Reddy',
        contactPerson: 'Suresh Reddy',
        mobile: '+919800000004',
        email: 'partner@iotaacademy.in',
        addressLine1: '#42, 5th Cross, 2nd Main, Indiranagar',
        city: 'Bengaluru',
        area: 'Indiranagar',
        pincode: '560038',
        latitude: 12.9716,
        longitude: 77.5946,
        status: PartnerStatus.ACTIVE,
        registrationUrl: 'https://iota-partner-portal-frontend.vercel.app/register/PTR-BLR-0001',
        bankAccountName: 'Apex Education Center',
        bankName: 'HDFC Bank',
        bankIfsc: 'HDFC0001234',
        bankAccountNumber: '98765432101234'
      }
    });
    console.log('✅ Sample Authorized Partner created: PTR-BLR-0001');
  }

  // 7. Seed Sample Premises for Field Canvassing
  const existingPremises = await prisma.premises.count();
  if (existingPremises === 0) {
    await prisma.premises.createMany({
      data: [
        {
          premisesName: 'Indira Tech Academy & Library',
          category: PartnerCategory.LIBRARY,
          ownerName: 'Ramesh Patel',
          contactPerson: 'Ramesh Patel',
          mobile: '+919811223344',
          addressLine1: '#108, CMH Road, Near Metro Station',
          city: 'Bengaluru',
          area: 'Indiranagar',
          pincode: '560038',
          latitude: 12.9784,
          longitude: 77.6408,
          currentStatus: PremisesStatus.UNASSIGNED
        },
        {
          premisesName: 'Bright Future Coaching Hub',
          category: PartnerCategory.COACHING_INSTITUTE,
          ownerName: 'Anil Kumar',
          contactPerson: 'Anil Kumar',
          mobile: '+919822334455',
          addressLine1: '#24, 80 Feet Road, 4th Block',
          city: 'Bengaluru',
          area: 'Koramangala',
          pincode: '560034',
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

