
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function createAdmin() {
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password) {
    throw new Error(
      'Please set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env',
    );
  }

  if (password.length < 8) {
    throw new Error('Admin password must be at least 12 characters');
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

    const hashedPassword = await bcrypt.hash(password, 12);
  if (existingUser) {
      const admin = await prisma.user.update({
    where: { email },
    data: {
      name,
      email,
      password: hashedPassword,
      role: UserRole.ADMIN,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });
    console.log('Admin created successfully:', admin);
  }
  else{

  const admin = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: UserRole.ADMIN,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });
    console.log('Admin created successfully:', admin);
  }




}

createAdmin()
  .catch((error) => {
    console.error('Admin creation failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });