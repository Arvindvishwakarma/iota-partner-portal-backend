import { prisma } from '../config/prisma';
import { PartnerCategory, PartnerStatus, Role } from '../shared';
import argon2 from 'argon2';

async function main() {
  const email = 'suresh@apexeducation.in';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const passwordHash = await argon2.hash('Partner@123456');
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: 'Suresh Reddy',
        phone: '+919800000004',
        role: Role.PARTNER,
        isActive: true
      }
    });
  }

  await prisma.partner.upsert({
    where: { partnerCode: 'PTR-BLR-0001' },
    update: {
      status: PartnerStatus.ACTIVE,
      businessName: 'Apex Computer Education Hub'
    },
    create: {
      userId: user.id,
      partnerCode: 'PTR-BLR-0001',
      businessName: 'Apex Computer Education Hub',
      category: PartnerCategory.COMPUTER_CENTER,
      ownerName: 'Suresh Reddy',
      contactPerson: 'Suresh Reddy',
      mobile: '+919800000004',
      email: 'suresh@apexeducation.in',
      addressLine1: '#82, 100ft Road, Indiranagar',
      city: 'Bengaluru',
      area: 'Indiranagar',
      pincode: '560038',
      status: PartnerStatus.ACTIVE,
      registrationUrl: 'http://localhost:3000/register/PTR-BLR-0001'
    }
  });

  console.log('SUCCESS: PTR-BLR-0001 created and active!');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
