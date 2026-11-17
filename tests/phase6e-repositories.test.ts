import crypto from 'crypto';
import { prisma, disconnectDatabase } from '../src/config/db.config';
import {
  workerProfileRepository,
  workerDocumentRepository,
  workerSkillRepository,
  workerInvitationRepository,
  workerPartnerAffiliationRepository,
  workerAvailabilityRepository,
} from '../src/modules/workers/repositories';
import {
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../src/common/errors';

describe('Phase 6E Batch 1: Worker Database Foundation & Repositories Integration Tests', () => {
  const MOB_WORKER_A = '+919666111001';
  const MOB_WORKER_B = '+919666111002';
  const MOB_PARTNER_A = '+919666222001';
  const MOB_PARTNER_B = '+919666222002';
  const MOB_INVITED_PROSPECTIVE = '+919666333001';
  const MOB_ADMIN = '+919666444001';

  let userWorkerAId: bigint;
  let userWorkerBId: bigint;
  let userPartnerAId: bigint;
  let userPartnerBId: bigint;
  let userAdminId: bigint;

  let partnerAProfileId: bigint;
  let partnerBProfileId: bigint;

  let workerAProfileId: bigint;
  let workerBProfileId: bigint;

  let serviceCategory1Id: bigint;
  let serviceCategory2Id: bigint;
  let primaryCityId: bigint;

  const hashToken = (token: string): string => {
    return crypto.createHash('sha256').update(token).digest('hex');
  };

  const createOrResetUser = async (mobileNumber: string) => {
    let user = await prisma.user.findUnique({ where: { mobileNumber } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          mobileNumber,
          accountStatus: 'ACTIVE',
          isMobileVerified: true,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { accountStatus: 'ACTIVE', isMobileVerified: true },
      });
    }
    return user;
  };

  const cleanupDatabase = async () => {
    try {
      await prisma.$executeRawUnsafe(`
        DELETE FROM public.worker_availability WHERE worker_id IN (
          SELECT id FROM public.worker_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.worker_partner_affiliations WHERE partner_id IN (
          SELECT id FROM public.partner_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
          )
        ) OR worker_id IN (
          SELECT id FROM public.worker_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.worker_invitations WHERE partner_id IN (
          SELECT id FROM public.partner_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
          )
        ) OR invited_mobile LIKE '+919666%';
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.worker_skills WHERE worker_id IN (
          SELECT id FROM public.worker_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.worker_documents WHERE worker_id IN (
          SELECT id FROM public.worker_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.worker_profiles WHERE user_id IN (
          SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.partner_profiles WHERE user_id IN (
          SELECT id FROM public.users WHERE mobile_number LIKE '+919666%'
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.users WHERE mobile_number LIKE '+919666%';
      `);
    } catch (err) {
      console.error('Phase 6E cleanup error:', err);
    }
  };

  beforeAll(async () => {
    await cleanupDatabase();

    // 1. Fetch or create city
    let city = await prisma.city.findFirst({ where: { isActive: true } });
    if (!city) {
      city = await prisma.city.create({
        data: {
          cityName: 'Bengaluru',
          citySlug: 'bengaluru-6e-test',
          countryCode: 'IN',
          stateName: 'Karnataka',
          isActive: true,
        },
      });
    }
    primaryCityId = city.id;

    // 2. Fetch or create service categories
    const categories = await prisma.serviceCategory.findMany({ take: 2 });
    if (categories.length >= 2) {
      serviceCategory1Id = categories[0].id;
      serviceCategory2Id = categories[1].id;
    } else {
      const cat1 = await prisma.serviceCategory.create({
        data: {
          categoryName: 'Home Cleaning 6E',
          categoryCode: 'CAT_CLEAN_6E',
          isActive: true,
        },
      });
      const cat2 = await prisma.serviceCategory.create({
        data: {
          categoryName: 'Electrical Services 6E',
          categoryCode: 'CAT_ELEC_6E',
          isActive: true,
        },
      });
      serviceCategory1Id = cat1.id;
      serviceCategory2Id = cat2.id;
    }

    // 3. Setup test users
    const uWA = await createOrResetUser(MOB_WORKER_A);
    const uWB = await createOrResetUser(MOB_WORKER_B);
    const uPA = await createOrResetUser(MOB_PARTNER_A);
    const uPB = await createOrResetUser(MOB_PARTNER_B);
    const uAdm = await createOrResetUser(MOB_ADMIN);

    userWorkerAId = uWA.id;
    userWorkerBId = uWB.id;
    userPartnerAId = uPA.id;
    userPartnerBId = uPB.id;
    userAdminId = uAdm.id;

    // 4. Setup partners
    const pA = await prisma.partnerProfile.create({
      data: {
        userId: userPartnerAId,
        legalName: 'Apex Home Services Partner',
        businessName: 'Apex Services',
        profileType: 'BUSINESS',
        approvalStatus: 'APPROVED',
      },
    });
    partnerAProfileId = pA.id;

    const pB = await prisma.partnerProfile.create({
      data: {
        userId: userPartnerBId,
        legalName: 'Prime Maintenance Partner',
        businessName: 'Prime Facility',
        profileType: 'BUSINESS',
        approvalStatus: 'APPROVED',
      },
    });
    partnerBProfileId = pB.id;
  });

  afterAll(async () => {
    await cleanupDatabase();
    await disconnectDatabase();
  });

  // =========================================================================
  // 1. WorkerProfileRepository Tests
  // =========================================================================
  describe('1. WorkerProfileRepository', () => {
    it('should create a worker profile successfully', async () => {
      const profile = await workerProfileRepository.create({
        userId: userWorkerAId,
        firstName: 'Ramesh',
        lastName: 'Kumar',
        dateOfBirth: new Date('1992-05-15'),
        gender: 'MALE',
        bio: 'Experienced plumbing and cleaning technician',
        workerType: 'TECHNICIAN',
        experienceYears: 5,
        primaryCityId,
      });

      expect(profile).toBeDefined();
      expect(profile.id).toBeDefined();
      expect(profile.userId).toBe(userWorkerAId);
      expect(profile.firstName).toBe('Ramesh');
      expect(profile.lastName).toBe('Kumar');
      expect(profile.workerType).toBe('TECHNICIAN');
      expect(profile.experienceYears).toBe(5);
      expect(profile.approvalStatus).toBe('PENDING');
      expect(profile.submissionStatus).toBe('DRAFT');
      expect(profile.isActive).toBe(true);

      workerAProfileId = profile.id;
    });

    it('should find worker profile by ID with user, city, and reviewer relations', async () => {
      const profile = await workerProfileRepository.findById(workerAProfileId);
      expect(profile).not.toBeNull();
      expect(profile!.id).toBe(workerAProfileId);
      expect((profile as any).user).toBeDefined();
      expect((profile as any).user.mobileNumber).toBe(MOB_WORKER_A);
      expect((profile as any).primaryCity).toBeDefined();
      expect((profile as any).primaryCity.id).toBe(primaryCityId);
    });

    it('should find worker profile by User ID', async () => {
      const profile = await workerProfileRepository.findByUserId(userWorkerAId);
      expect(profile).not.toBeNull();
      expect(profile!.id).toBe(workerAProfileId);
    });

    it('should prevent duplicate worker profiles for the same user (ConflictError)', async () => {
      await expect(
        workerProfileRepository.create({
          userId: userWorkerAId,
          firstName: 'Duplicate',
          lastName: 'Worker',
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should update worker profile fields successfully', async () => {
      const updated = await workerProfileRepository.update(workerAProfileId, {
        bio: 'Updated bio with 6 years experience',
        experienceYears: 6,
        workerType: 'SPECIALIST',
      });

      expect(updated.experienceYears).toBe(6);
      expect(updated.workerType).toBe('SPECIALIST');
      expect(updated.bio).toBe('Updated bio with 6 years experience');
    });

    it('should transition submission status on onboarding submission', async () => {
      const submitted = await workerProfileRepository.submitOnboarding(workerAProfileId);
      expect(submitted.submissionStatus).toBe('SUBMITTED');
      expect(submitted.submittedAt).not.toBeNull();
    });

    it('should update approval status with reviewer metadata', async () => {
      const approved = await workerProfileRepository.updateApprovalStatus(
        workerAProfileId,
        'APPROVED',
        userAdminId
      );

      expect(approved.approvalStatus).toBe('APPROVED');
      expect(approved.reviewedBy).toBe(userAdminId);
      expect(approved.reviewedAt).not.toBeNull();
    });

    it('should update suspension status with reason and timestamp', async () => {
      const suspended = await workerProfileRepository.updateSuspensionStatus(
        workerAProfileId,
        'SUSPENDED',
        'Policy violation for unannounced absence'
      );

      expect(suspended.approvalStatus).toBe('SUSPENDED');
      expect(suspended.suspensionReason).toBe('Policy violation for unannounced absence');
      expect(suspended.suspendedAt).not.toBeNull();

      // Reactivate back to APPROVED for subsequent tests
      await workerProfileRepository.updateApprovalStatus(workerAProfileId, 'APPROVED', userAdminId);
    });

    it('should query worker profiles with pagination and filters', async () => {
      // Create Worker B
      const workerB = await workerProfileRepository.create({
        userId: userWorkerBId,
        firstName: 'Suresh',
        lastName: 'Patel',
        workerType: 'HELPER',
        experienceYears: 2,
        primaryCityId,
        approvalStatus: 'PENDING',
      });
      workerBProfileId = workerB.id;

      const result = await workerProfileRepository.findMany(
        { approvalStatus: 'APPROVED' },
        { page: 1, limit: 10 }
      );

      expect(result.items.some((w) => w.id === workerAProfileId)).toBe(true);
      expect(result.items.some((w) => w.id === workerBProfileId)).toBe(false);

      const searchResult = await workerProfileRepository.findMany(
        { search: 'Suresh' },
        { page: 1, limit: 10 }
      );
      expect(searchResult.items.some((w) => w.id === workerBProfileId)).toBe(true);
    });
  });

  // =========================================================================
  // 2. WorkerDocumentRepository Tests
  // =========================================================================
  describe('2. WorkerDocumentRepository', () => {
    let doc1Id: bigint;
    let doc2Id: bigint;

    it('should create a worker document record', async () => {
      const doc = await workerDocumentRepository.create({
        workerId: workerAProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'workers/docs/aadhaar_v1.pdf',
        originalName: 'aadhaar_front_back.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(204850),
        verificationStatus: 'PENDING',
      });

      expect(doc).toBeDefined();
      expect(doc.id).toBeDefined();
      expect(doc.workerId).toBe(workerAProfileId);
      expect(doc.documentType).toBe('IDENTITY_PROOF');
      expect(doc.verificationStatus).toBe('PENDING');
      expect(doc.originalName).toBe('aadhaar_front_back.pdf');
      expect(doc.fileSizeBytes).toBe(BigInt(204850));

      doc1Id = doc.id;
    });

    it('should find document by ID with worker details', async () => {
      const doc = await workerDocumentRepository.findById(doc1Id);
      expect(doc).not.toBeNull();
      expect(doc!.id).toBe(doc1Id);
      expect((doc as any).worker).toBeDefined();
      expect((doc as any).worker.user.mobileNumber).toBe(MOB_WORKER_A);
    });

    it('should support additive document versioning (preserving history)', async () => {
      // Worker uploads a second (superseding) version of IDENTITY_PROOF
      const doc2 = await workerDocumentRepository.create({
        workerId: workerAProfileId,
        documentType: 'IDENTITY_PROOF',
        documentStorageKey: 'workers/docs/aadhaar_v2.pdf',
        originalName: 'aadhaar_updated.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(250000),
        verificationStatus: 'PENDING',
      });
      doc2Id = doc2.id;

      // Both versions must exist in history
      const allDocs = await workerDocumentRepository.findByWorkerId(workerAProfileId);
      const identityDocs = allDocs.filter((d) => d.documentType === 'IDENTITY_PROOF');
      expect(identityDocs.length).toBe(2);
      expect(identityDocs[0].id).toBe(doc2Id); // newest first
      expect(identityDocs[1].id).toBe(doc1Id);
    });

    it('should find latest document by type correctly', async () => {
      const latestIdentity = await workerDocumentRepository.findLatestByType(
        workerAProfileId,
        'IDENTITY_PROOF'
      );
      expect(latestIdentity).not.toBeNull();
      expect(latestIdentity!.id).toBe(doc2Id);
      expect(latestIdentity!.documentStorageKey).toBe('workers/docs/aadhaar_v2.pdf');
    });

    it('should list latest documents across all types using findLatestByWorker', async () => {
      // Add an ADDRESS_PROOF document
      await workerDocumentRepository.create({
        workerId: workerAProfileId,
        documentType: 'ADDRESS_PROOF',
        documentStorageKey: 'workers/docs/electricity_bill_v1.pdf',
        originalName: 'electricity_bill.pdf',
        verificationStatus: 'PENDING',
      });

      const latestDocs = await workerDocumentRepository.findLatestByWorker(workerAProfileId);
      expect(latestDocs.length).toBe(2); // 1 IDENTITY_PROOF (v2) and 1 ADDRESS_PROOF
      const types = latestDocs.map((d) => d.documentType);
      expect(types).toContain('IDENTITY_PROOF');
      expect(types).toContain('ADDRESS_PROOF');

      const latestIdentity = latestDocs.find((d) => d.documentType === 'IDENTITY_PROOF');
      expect(latestIdentity!.id).toBe(doc2Id);
    });

    it('should update verification status with reviewer information', async () => {
      const verified = await workerDocumentRepository.updateVerificationStatus(doc2Id, {
        verificationStatus: 'VERIFIED',
        reviewedBy: userAdminId,
      });

      expect(verified.verificationStatus).toBe('VERIFIED');
      expect(verified.reviewedBy).toBe(userAdminId);
      expect(verified.reviewedAt).not.toBeNull();
    });

    it('should query pending verification documents in FIFO queue', async () => {
      const pending = await workerDocumentRepository.findPendingVerification({ page: 1, limit: 10 });
      expect(pending.items.every((d) => d.verificationStatus === 'PENDING')).toBe(true);
    });
  });

  // =========================================================================
  // 3. WorkerSkillRepository Tests
  // =========================================================================
  describe('3. WorkerSkillRepository', () => {
    let skill1Id: bigint;

    it('should add a skill to a worker profile', async () => {
      const skill = await workerSkillRepository.create({
        workerId: workerAProfileId,
        serviceCategoryId: serviceCategory1Id,
        experienceYears: 4,
        verificationStatus: 'PENDING',
      });

      expect(skill).toBeDefined();
      expect(skill.id).toBeDefined();
      expect(skill.workerId).toBe(workerAProfileId);
      expect(skill.serviceCategoryId).toBe(serviceCategory1Id);
      expect(skill.experienceYears).toBe(4);
      expect(skill.verificationStatus).toBe('PENDING');

      skill1Id = skill.id;
    });

    it('should find skill by ID with worker and category relations', async () => {
      const skill = await workerSkillRepository.findById(skill1Id);
      expect(skill).not.toBeNull();
      expect(skill!.id).toBe(skill1Id);
      expect((skill as any).worker).toBeDefined();
      expect((skill as any).serviceCategory).toBeDefined();
      expect((skill as any).serviceCategory.id).toBe(serviceCategory1Id);
    });

    it('should find skill by worker and category (findByCategory)', async () => {
      const skill = await workerSkillRepository.findByCategory(
        workerAProfileId,
        serviceCategory1Id
      );
      expect(skill).not.toBeNull();
      expect(skill!.id).toBe(skill1Id);
    });

    it('should reject duplicate skill for the same worker and category (ConflictError)', async () => {
      await expect(
        workerSkillRepository.create({
          workerId: workerAProfileId,
          serviceCategoryId: serviceCategory1Id,
          experienceYears: 5,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should update skill verification status', async () => {
      const verified = await workerSkillRepository.updateVerificationStatus(skill1Id, {
        verificationStatus: 'VERIFIED',
        reviewedBy: userAdminId,
      });

      expect(verified.verificationStatus).toBe('VERIFIED');
      expect(verified.reviewedBy).toBe(userAdminId);
      expect(verified.reviewedAt).not.toBeNull();
    });

    it('should list all skills for a worker', async () => {
      // Add second skill
      await workerSkillRepository.create({
        workerId: workerAProfileId,
        serviceCategoryId: serviceCategory2Id,
        experienceYears: 2,
        verificationStatus: 'PENDING',
      });

      const skills = await workerSkillRepository.findByWorkerId(workerAProfileId);
      expect(skills.length).toBe(2);
    });

    it('should delete a skill record successfully', async () => {
      const skill2 = await workerSkillRepository.findByCategory(
        workerAProfileId,
        serviceCategory2Id
      );
      expect(skill2).not.toBeNull();

      await workerSkillRepository.delete(skill2!.id);

      const afterDelete = await workerSkillRepository.findByCategory(
        workerAProfileId,
        serviceCategory2Id
      );
      expect(afterDelete).toBeNull();
    });
  });

  // =========================================================================
  // 4. WorkerInvitationRepository Tests
  // =========================================================================
  describe('4. WorkerInvitationRepository', () => {
    let invitation1Id: bigint;
    const rawToken1 = 'test_token_secret_12345';
    const tokenHash1 = crypto.createHash('sha256').update(rawToken1).digest('hex');

    it('should create a worker invitation with hashed token', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invitation = await workerInvitationRepository.create({
        partnerId: partnerAProfileId,
        invitingUserId: userPartnerAId,
        invitedMobile: MOB_INVITED_PROSPECTIVE,
        workerName: 'Prospective Helper',
        invitationTokenHash: tokenHash1,
        proposedRole: 'HELPER',
        notes: 'Joining for residential moving & cleaning',
        expiresAt,
      });

      expect(invitation).toBeDefined();
      expect(invitation.id).toBeDefined();
      expect(invitation.partnerId).toBe(partnerAProfileId);
      expect(invitation.invitedMobile).toBe(MOB_INVITED_PROSPECTIVE);
      expect(invitation.invitationStatus).toBe('PENDING');
      expect(invitation.invitationTokenHash).toBe(tokenHash1);
      expect(invitation.resendCount).toBe(0);

      invitation1Id = invitation.id;
    });

    it('should find invitation by ID and by token hash', async () => {
      const byId = await workerInvitationRepository.findById(invitation1Id);
      expect(byId).not.toBeNull();
      expect(byId!.id).toBe(invitation1Id);
      expect((byId as any).partner.id).toBe(partnerAProfileId);

      const byHash = await workerInvitationRepository.findByTokenHash(tokenHash1);
      expect(byHash).not.toBeNull();
      expect(byHash!.id).toBe(invitation1Id);
    });

    it('should find pending invitation by partner and mobile', async () => {
      const pending = await workerInvitationRepository.findPendingByPartnerAndMobile(
        partnerAProfileId,
        MOB_INVITED_PROSPECTIVE
      );
      expect(pending).not.toBeNull();
      expect(pending!.id).toBe(invitation1Id);
    });

    it('should reject a duplicate PENDING invitation from the same partner to the same mobile (ConflictError)', async () => {
      const tokenHashDup = hashToken('another_token_dup');
      await expect(
        workerInvitationRepository.create({
          partnerId: partnerAProfileId,
          invitedMobile: MOB_INVITED_PROSPECTIVE,
          invitationTokenHash: tokenHashDup,
          expiresAt: new Date(Date.now() + 86400000),
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should allow MULTIPLE DIFFERENT partners to invite the SAME mobile simultaneously', async () => {
      const tokenHashPartnerB = hashToken('partner_b_token_invite');
      const invitationB = await workerInvitationRepository.create({
        partnerId: partnerBProfileId,
        invitingUserId: userPartnerBId,
        invitedMobile: MOB_INVITED_PROSPECTIVE,
        invitationTokenHash: tokenHashPartnerB,
        proposedRole: 'CLEANER',
        expiresAt: new Date(Date.now() + 86400000),
      });

      expect(invitationB).toBeDefined();
      expect(invitationB.partnerId).toBe(partnerBProfileId);
      expect(invitationB.invitedMobile).toBe(MOB_INVITED_PROSPECTIVE);

      // Clean up Partner B's invitation so as not to affect subsequent tests
      await workerInvitationRepository.updateStatus(invitationB.id, 'REVOKED');
    });

    it('should list invitations received for a mobile number', async () => {
      const result = await workerInvitationRepository.listReceivedForMobile(
        MOB_INVITED_PROSPECTIVE
      );
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.some((i) => i.id === invitation1Id)).toBe(true);
    });

    it('should list invitations created by a partner', async () => {
      const result = await workerInvitationRepository.listCreatedByPartner(partnerAProfileId);
      expect(result.items.some((i) => i.id === invitation1Id)).toBe(true);
    });

    it('should increment resend count successfully', async () => {
      const updated = await workerInvitationRepository.incrementResendCount(invitation1Id);
      expect(updated.resendCount).toBe(1);
    });

    it('should perform conditional atomic state transitions', async () => {
      // 1. Transition PENDING -> ACCEPTED succeeds
      const transitioned = await workerInvitationRepository.atomicTransitionStatus(
        invitation1Id,
        'PENDING',
        'ACCEPTED',
        { respondedAt: new Date() }
      );
      expect(transitioned).not.toBeNull();
      expect(transitioned!.invitationStatus).toBe('ACCEPTED');

      // 2. Transition again from PENDING fails and returns null because status is now ACCEPTED
      const failedTransition = await workerInvitationRepository.atomicTransitionStatus(
        invitation1Id,
        'PENDING',
        'REJECTED'
      );
      expect(failedTransition).toBeNull();
    });

    it('should batch expire past invitations using expireEligibleInvitations', async () => {
      // Create an expired invitation in the past
      const pastHash = hashToken('past_token_to_expire');
      const pastInvitation = await workerInvitationRepository.create({
        partnerId: partnerAProfileId,
        invitedMobile: '+919666999999',
        invitationTokenHash: pastHash,
        expiresAt: new Date(Date.now() - 10000), // already in past
      });

      const count = await workerInvitationRepository.expireEligibleInvitations();
      expect(count).toBeGreaterThanOrEqual(1);

      const check = await workerInvitationRepository.findById(pastInvitation.id);
      expect(check!.invitationStatus).toBe('EXPIRED');
    });
  });

  // =========================================================================
  // 5. WorkerPartnerAffiliationRepository Tests
  // =========================================================================
  describe('5. WorkerPartnerAffiliationRepository', () => {
    let affiliationAId: bigint;
    let affiliationBId: bigint;

    it('should create an active affiliation between worker and partner', async () => {
      const affiliation = await workerPartnerAffiliationRepository.create({
        workerId: workerAProfileId,
        partnerId: partnerAProfileId,
        affiliationStatus: 'ACTIVE',
      });

      expect(affiliation).toBeDefined();
      expect(affiliation.id).toBeDefined();
      expect(affiliation.workerId).toBe(workerAProfileId);
      expect(affiliation.partnerId).toBe(partnerAProfileId);
      expect(affiliation.affiliationStatus).toBe('ACTIVE');

      affiliationAId = affiliation.id;
    });

    it('should find affiliation by ID and active affiliation between worker and partner', async () => {
      const byId = await workerPartnerAffiliationRepository.findById(affiliationAId);
      expect(byId).not.toBeNull();
      expect(byId!.id).toBe(affiliationAId);

      const active = await workerPartnerAffiliationRepository.findActive(
        workerAProfileId,
        partnerAProfileId
      );
      expect(active).not.toBeNull();
      expect(active!.id).toBe(affiliationAId);
    });

    it('should prevent duplicate ACTIVE affiliations for the SAME worker and partner (ConflictError)', async () => {
      await expect(
        workerPartnerAffiliationRepository.create({
          workerId: workerAProfileId,
          partnerId: partnerAProfileId,
          affiliationStatus: 'ACTIVE',
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should allow MULTIPLE ACTIVE affiliations for the same worker across DIFFERENT partners', async () => {
      // Worker A associates with Partner B as well
      const affB = await workerPartnerAffiliationRepository.create({
        workerId: workerAProfileId,
        partnerId: partnerBProfileId,
        affiliationStatus: 'ACTIVE',
      });

      expect(affB).toBeDefined();
      expect(affB.workerId).toBe(workerAProfileId);
      expect(affB.partnerId).toBe(partnerBProfileId);
      expect(affB.affiliationStatus).toBe('ACTIVE');

      affiliationBId = affB.id;

      const activeList = await workerPartnerAffiliationRepository.listActiveByWorker(
        workerAProfileId
      );
      expect(activeList.length).toBe(2);
      const partnerIds = activeList.map((a) => a.partnerId);
      expect(partnerIds).toContain(partnerAProfileId);
      expect(partnerIds).toContain(partnerBProfileId);
    });

    it('should list active affiliations for a partner', async () => {
      const listA = await workerPartnerAffiliationRepository.listActiveByPartner(
        partnerAProfileId
      );
      expect(listA.items.some((a) => a.id === affiliationAId)).toBe(true);
    });

    it('should terminate an affiliation while preserving the historical record', async () => {
      const terminated = await workerPartnerAffiliationRepository.terminate(
        affiliationAId,
        'Worker opted for different partner fleet'
      );

      expect(terminated.affiliationStatus).toBe('TERMINATED');
      expect(terminated.terminationReason).toBe('Worker opted for different partner fleet');
      expect(terminated.terminatedAt).not.toBeNull();

      // Active query between worker and partner A must now return null
      const active = await workerPartnerAffiliationRepository.findActive(
        workerAProfileId,
        partnerAProfileId
      );
      expect(active).toBeNull();

      // But historical query still returns it
      const history = await workerPartnerAffiliationRepository.listByWorker(workerAProfileId);
      expect(history.items.some((a) => a.id === affiliationAId)).toBe(true);
    });

    it('should allow a NEW active affiliation between the same worker and partner after prior termination', async () => {
      // Re-affiliate after earlier termination
      const newAff = await workerPartnerAffiliationRepository.create({
        workerId: workerAProfileId,
        partnerId: partnerAProfileId,
        affiliationStatus: 'ACTIVE',
      });

      expect(newAff).toBeDefined();
      expect(newAff.id).not.toBe(affiliationAId);
      expect(newAff.affiliationStatus).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // 6. WorkerAvailabilityRepository Tests
  // =========================================================================
  describe('6. WorkerAvailabilityRepository', () => {
    it('should upsert worker availability record', async () => {
      const avail = await workerAvailabilityRepository.upsertAvailability(workerAProfileId, {
        isOnline: true,
        isBusy: false,
        currentLatitude: 12.9716,
        currentLongitude: 77.5946,
      });

      expect(avail).toBeDefined();
      expect(avail.workerId).toBe(workerAProfileId);
      expect(avail.isOnline).toBe(true);
      expect(avail.isBusy).toBe(false);
      expect(avail.lastHeartbeatAt).not.toBeNull();
      expect(avail.currentLatitude).not.toBeNull();
    });

    it('should find availability by worker ID', async () => {
      const avail = await workerAvailabilityRepository.findByWorkerId(workerAProfileId);
      expect(avail).not.toBeNull();
      expect(avail!.workerId).toBe(workerAProfileId);
      expect((avail as any).worker).toBeDefined();
    });

    it('should update duty status (toggle offline/busy)', async () => {
      const offline = await workerAvailabilityRepository.updateDutyStatus(
        workerAProfileId,
        false,
        false
      );
      expect(offline.isOnline).toBe(false);
      expect(offline.isBusy).toBe(false);

      const onlineBusy = await workerAvailabilityRepository.updateDutyStatus(
        workerAProfileId,
        true,
        true
      );
      expect(onlineBusy.isOnline).toBe(true);
      expect(onlineBusy.isBusy).toBe(true);
    });

    it('should update heartbeat and coordinates', async () => {
      const updated = await workerAvailabilityRepository.updateHeartbeat(
        workerAProfileId,
        12.9800,
        77.6000
      );
      expect(updated.isOnline).toBe(true);
      expect(updated.lastHeartbeatAt).not.toBeNull();
    });

    it('should list online and available workers', async () => {
      // Set worker A to online and not busy
      await workerAvailabilityRepository.updateDutyStatus(workerAProfileId, true, false);

      const onlineList = await workerAvailabilityRepository.findOnlineAvailable();
      expect(onlineList.some((w) => w.workerId === workerAProfileId)).toBe(true);
    });
  });

  // =========================================================================
  // 7. Transaction Isolation & Rollback Atomicity
  // =========================================================================
  describe('7. Transaction Isolation & Rollback Atomicity', () => {
    it('should rollback all operations if an error occurs within a Prisma transaction', async () => {
      const tempMobile = '+919666777888';
      const tempUser = await createOrResetUser(tempMobile);

      let createdWorkerId: bigint | null = null;

      try {
        await prisma.$transaction(async (tx) => {
          // 1. Create worker profile within tx
          const worker = await workerProfileRepository.create(
            {
              userId: tempUser.id,
              firstName: 'Rollback',
              lastName: 'Tester',
            },
            tx
          );
          createdWorkerId = worker.id;

          // 2. Create document within tx
          await workerDocumentRepository.create(
            {
              workerId: worker.id,
              documentType: 'IDENTITY_PROOF',
              documentStorageKey: 'temp/docs/id.pdf',
            },
            tx
          );

          // 3. Deliberately trigger an error within transaction
          throw new Error('Simulated atomic transaction failure');
        });
      } catch (err: any) {
        expect(err.message).toBe('Simulated atomic transaction failure');
      }

      // Profile must NOT exist in the database
      if (createdWorkerId) {
        const profileAfter = await workerProfileRepository.findById(createdWorkerId);
        expect(profileAfter).toBeNull();
      }

      const userAfter = await workerProfileRepository.findByUserId(tempUser.id);
      expect(userAfter).toBeNull();
    });
  });
});
