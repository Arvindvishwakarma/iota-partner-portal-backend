import { prisma } from '../config/prisma';
import { AffiliateStatus, Gender, Role } from '../shared';
import { toPrismaOccupation } from '../utils/user-display';
import argon2 from 'argon2';

async function main() {
  const email = 'suresh@apexeducation.in';
  let user = await prisma.user.findUnique({ where: { emailAddress: email } });
  if (!user) {
    const passwordHash = await argon2.hash('Partner@123456');
    user = await prisma.user.create({
      data: {
        firstName: 'Suresh',
        lastName: 'Reddy',
        emailAddress: email,
        password: passwordHash,
        mobileNumber: '+919800000004',
        whatsappNumber: '+919800000004',
        gender: Gender.Male as any,
        age: 34,
        occupation: toPrismaOccupation('Business Owner'),
        communicationAddress: '#82, 100ft Road, Indiranagar, Bengaluru',
        role: Role.AFFILIATE as any,
        isActive: true
      }
    });
  }

  await prisma.affiliate.upsert({
    where: { affiliateCode: 'IAA00101' },
    update: {
      status: AffiliateStatus.ACTIVE,
      firmName: 'Apex Computer Education Hub'
    },
    create: {
      userId: user.id,
      affiliateCode: 'IAA00101',
      firstName: 'Suresh',
      lastName: 'Reddy',
      gender: Gender.Male as any,
      age: 34,
      mobileNumber: '+919800000004',
      whatsappNumber: '+919800000004',
      emailAddress: 'suresh@apexeducation.in',
      communicationAddress: '#82, 100ft Road, Indiranagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
      occupation: toPrismaOccupation('Business Owner'),
      firmName: 'Apex Computer Education Hub',
      ownerBusinessType: 'Computer Center',
      status: AffiliateStatus.ACTIVE,
      registrationUrl: 'https://affiliate.iotaacademy.in/register/IAA00101'
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
