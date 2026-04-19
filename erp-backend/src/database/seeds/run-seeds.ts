import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import { User } from '@modules/auth/entities/user.entity';
import { Role } from '@modules/auth/entities/role.entity';
import { UserRole } from '@modules/auth/entities/user-role.entity';

dotenv.config();

const DEFAULT_TENANT_SLUG = process.env.SEED_TENANT_SLUG || 'default';
const DEFAULT_TENANT_NAME = process.env.SEED_TENANT_NAME || 'Default Organization';
const DEFAULT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@erp.local';
const DEFAULT_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
const DEFAULT_ADMIN_NAME = process.env.SEED_ADMIN_NAME || 'System Administrator';

async function run() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'erp_admin',
    password: process.env.DB_PASSWORD || 'erp_secret',
    database: process.env.DB_NAME || 'erp_saas',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    entities: ['src/**/*.entity.ts'],
    synchronize: true,
    logging: process.env.DB_LOGGING === 'true',
  });

  await dataSource.initialize();
  console.log('Connected. Seeding default tenant and admin user...');

  const tenantRepo = dataSource.getRepository(Tenant);
  const userRepo = dataSource.getRepository(User);
  const roleRepo = dataSource.getRepository(Role);
  const userRoleRepo = dataSource.getRepository(UserRole);

  let tenant = await tenantRepo.findOne({ where: { slug: DEFAULT_TENANT_SLUG } });
  if (!tenant) {
    tenant = await tenantRepo.save(
      tenantRepo.create({
        slug: DEFAULT_TENANT_SLUG,
        name: DEFAULT_TENANT_NAME,
        plan: 'starter',
        isActive: true,
        settings: {},
      }),
    );
    console.log(`Created tenant "${tenant.slug}" (${tenant.id})`);
  } else {
    console.log(`Tenant "${tenant.slug}" already exists (${tenant.id})`);
  }

  let adminRole = await roleRepo.findOne({
    where: { tenantId: tenant.id, name: 'Admin' },
  });
  if (!adminRole) {
    adminRole = await roleRepo.save(
      roleRepo.create({
        tenantId: tenant.id,
        name: 'Admin',
        description: 'Full system access',
        isSystemRole: true,
      }),
    );
    console.log(`Created role "Admin" (${adminRole.id})`);
  } else {
    console.log(`Role "Admin" already exists (${adminRole.id})`);
  }

  let user = await userRepo.findOne({
    where: { email: DEFAULT_ADMIN_EMAIL, tenantId: tenant.id },
  });
  if (!user) {
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
    user = await userRepo.save(
      userRepo.create({
        tenantId: tenant.id,
        name: DEFAULT_ADMIN_NAME,
        email: DEFAULT_ADMIN_EMAIL,
        passwordHash,
        isActive: true,
      }),
    );
    console.log(`Created admin user "${user.email}" (${user.id})`);
  } else {
    console.log(`Admin user "${user.email}" already exists (${user.id})`);
  }

  const existingAssignment = await userRoleRepo.findOne({
    where: { userId: user.id, roleId: adminRole.id },
  });
  if (!existingAssignment) {
    await userRoleRepo.save(
      userRoleRepo.create({
        userId: user.id,
        roleId: adminRole.id,
        branchIds: [],
      }),
    );
    console.log('Assigned Admin role to admin user');
  } else {
    console.log('Admin role already assigned to admin user');
  }

  console.log('\nSeed complete. Login with:');
  console.log(`  Tenant slug : ${tenant.slug}`);
  console.log(`  Email       : ${DEFAULT_ADMIN_EMAIL}`);
  console.log(`  Password    : ${DEFAULT_ADMIN_PASSWORD}`);

  await dataSource.destroy();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
