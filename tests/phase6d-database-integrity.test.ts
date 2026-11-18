import { prisma, disconnectDatabase } from '../src/config/db.config';

describe('Phase 6D Milestone 1: Database Foundation & PostgreSQL Integrity Constraints', () => {
  const MOB_DRIVER_1 = '+919888111001';
  const MOB_DRIVER_2 = '+919888111002';
  const MOB_PARTNER_1 = '+919888222001';
  const MOB_PARTNER_2 = '+919888222002';
  const MOB_INVITED_1 = '+919888333001';

  let userDriver1Id: bigint;
  let userDriver2Id: bigint;
  let userPartner1Id: bigint;
  let userPartner2Id: bigint;

  let partner1ProfileId: bigint;
  let partner2ProfileId: bigint;

  let driver1ProfileId: bigint;
  let driver2ProfileId: bigint;

  let vehicle1Id: bigint;
  let vehicle2Id: bigint;
  let vehicleTypeId: bigint;

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
      // Clean up in reverse dependency order
      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_availability WHERE driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number IN ('${MOB_DRIVER_1}', '${MOB_DRIVER_2}', '${MOB_PARTNER_1}', '${MOB_PARTNER_2}', '${MOB_INVITED_1}')
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_vehicle_assignments WHERE driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number IN ('${MOB_DRIVER_1}', '${MOB_DRIVER_2}', '${MOB_PARTNER_1}', '${MOB_PARTNER_2}', '${MOB_INVITED_1}')
          )
        ) OR vehicle_id IN (
          SELECT id FROM public.vehicles WHERE registration_number IN ('KA01D6D001', 'KA01D6D002')
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_partner_affiliations WHERE driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number IN ('${MOB_DRIVER_1}', '${MOB_DRIVER_2}', '${MOB_PARTNER_1}', '${MOB_PARTNER_2}', '${MOB_INVITED_1}')
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_invitations WHERE invited_mobile IN ('${MOB_DRIVER_1}', '${MOB_DRIVER_2}', '${MOB_INVITED_1}');
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_documents WHERE driver_id IN (
          SELECT id FROM public.driver_profiles WHERE user_id IN (
            SELECT id FROM public.users WHERE mobile_number IN ('${MOB_DRIVER_1}', '${MOB_DRIVER_2}', '${MOB_PARTNER_1}', '${MOB_PARTNER_2}', '${MOB_INVITED_1}')
          )
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.driver_profiles WHERE user_id IN (
          SELECT id FROM public.users WHERE mobile_number IN ('${MOB_DRIVER_1}', '${MOB_DRIVER_2}', '${MOB_PARTNER_1}', '${MOB_PARTNER_2}', '${MOB_INVITED_1}')
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.partner_vehicles WHERE vehicle_id IN (
          SELECT id FROM public.vehicles WHERE registration_number IN ('KA01D6D001', 'KA01D6D002')
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.vehicle_documents WHERE vehicle_id IN (
          SELECT id FROM public.vehicles WHERE registration_number IN ('KA01D6D001', 'KA01D6D002')
        );
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.vehicles WHERE registration_number IN ('KA01D6D001', 'KA01D6D002');
      `);

      await prisma.$executeRawUnsafe(`
        DELETE FROM public.partner_profiles WHERE user_id IN (
          SELECT id FROM public.users WHERE mobile_number IN ('${MOB_PARTNER_1}', '${MOB_PARTNER_2}')
        );
      `);
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  };

  beforeAll(async () => {
    await cleanupDatabase();

    // 1. Fetch or create a vehicle type
    const vType = await prisma.vehicleType.findFirst();
    if (!vType) {
      const cat = await prisma.serviceCategory.findFirst();
      const newType = await prisma.vehicleType.create({
        data: {
          typeCode: 'TATA_ACE_6D',
          typeName: 'Tata Ace 6D Test',
          serviceCategoryId: cat!.id,
          capacityKg: 850,
          baseFare: 250,
          perKmRate: 18,
          perMinuteRate: 2,
        },
      });
      vehicleTypeId = newType.id;
    } else {
      vehicleTypeId = vType.id;
    }

    // 2. Setup users
    const uD1 = await createOrResetUser(MOB_DRIVER_1);
    const uD2 = await createOrResetUser(MOB_DRIVER_2);
    const uP1 = await createOrResetUser(MOB_PARTNER_1);
    const uP2 = await createOrResetUser(MOB_PARTNER_2);

    userDriver1Id = uD1.id;
    userDriver2Id = uD2.id;
    userPartner1Id = uP1.id;
    userPartner2Id = uP2.id;

    // 3. Setup partner profiles
    const p1 = await prisma.partnerProfile.create({
      data: {
        userId: userPartner1Id,
        legalName: 'Fleet Partner Alpha',
        profileType: 'BUSINESS',
        approvalStatus: 'APPROVED',
      },
    });
    partner1ProfileId = p1.id;

    const p2 = await prisma.partnerProfile.create({
      data: {
        userId: userPartner2Id,
        legalName: 'Fleet Partner Beta',
        profileType: 'BUSINESS',
        approvalStatus: 'APPROVED',
      },
    });
    partner2ProfileId = p2.id;

    // 4. Setup driver profiles
    const d1 = await prisma.driverProfile.create({
      data: {
        userId: userDriver1Id,
        firstName: 'Rajesh',
        lastName: 'Kumar',
        experienceYears: 5,
        licenceNumber: 'DL-04-2015-1234567',
        licenceClasses: ['LMV', 'TRANS'],
        approvalStatus: 'APPROVED',
        submissionStatus: 'APPROVED',
      },
    });
    driver1ProfileId = d1.id;

    const d2 = await prisma.driverProfile.create({
      data: {
        userId: userDriver2Id,
        firstName: 'Suresh',
        lastName: 'Verma',
        experienceYears: 3,
        licenceNumber: 'DL-04-2018-7654321',
        licenceClasses: ['LMV'],
        approvalStatus: 'APPROVED',
        submissionStatus: 'APPROVED',
      },
    });
    driver2ProfileId = d2.id;

    // 5. Setup vehicles
    const v1 = await prisma.vehicle.create({
      data: {
        registrationNumber: 'KA01D6D001',
        vehicleTypeId,
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    vehicle1Id = v1.id;

    const v2 = await prisma.vehicle.create({
      data: {
        registrationNumber: 'KA01D6D002',
        vehicleTypeId,
        verificationStatus: 'VERIFIED',
        isActive: true,
      },
    });
    vehicle2Id = v2.id;

    // Link vehicles to partner 1
    await prisma.partnerVehicle.create({
      data: {
        partnerId: partner1ProfileId,
        vehicleId: vehicle1Id,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: true,
      },
    });

    await prisma.partnerVehicle.create({
      data: {
        partnerId: partner1ProfileId,
        vehicleId: vehicle2Id,
        ownershipType: 'OWNER',
        ownershipStatus: 'ACTIVE',
        isPrimary: false,
      },
    });
  });

  afterAll(async () => {
    await cleanupDatabase();
    await disconnectDatabase();
  });

  // -------------------------------------------------------------
  // Test 1: Driver profile uniqueness per user
  // -------------------------------------------------------------
  test('1. Driver profile uniqueness: should reject second driver profile for same user', async () => {
    let thrownError: any = null;
    try {
      await prisma.driverProfile.create({
        data: {
          userId: userDriver1Id, // Same userId as driver 1
          firstName: 'Duplicate',
          lastName: 'Driver',
        },
      });
    } catch (err: any) {
      thrownError = err;
    }

    expect(thrownError).not.toBeNull();
    // Unique violation in Prisma is P2002 or PostgreSQL error 23505
    expect(thrownError.message).toMatch(/Unique constraint failed on the fields: \(`user_id`\)|23505/i);
  });

  // -------------------------------------------------------------
  // Test 2: Duplicate pending invitation prevention
  // -------------------------------------------------------------
  test('2. Duplicate pending invitations: should reject multiple PENDING invitations from same partner to same mobile', async () => {
    const token1 = 'tok_inv_test_001_' + Date.now();
    const token2 = 'tok_inv_test_002_' + Date.now();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // First invitation should succeed
    const inv1 = await prisma.driverInvitation.create({
      data: {
        partnerId: partner1ProfileId,
        invitedMobile: MOB_INVITED_1,
        driverName: 'Prospective Driver',
        invitationToken: token1,
        invitationStatus: 'PENDING',
        expiresAt,
      },
    });
    expect(inv1.id).toBeDefined();

    // Second PENDING invitation to same mobile from same partner must fail
    let thrownError: any = null;
    try {
      await prisma.driverInvitation.create({
        data: {
          partnerId: partner1ProfileId,
          invitedMobile: MOB_INVITED_1,
          driverName: 'Duplicate Attempt',
          invitationToken: token2,
          invitationStatus: 'PENDING',
          expiresAt,
        },
      });
    } catch (err: any) {
      thrownError = err;
    }

    expect(thrownError).not.toBeNull();
    // Partial unique index idx_one_pending_invitation_per_partner_driver violation
    expect(thrownError.message).toMatch(/unique|23505|idx_one_pending_invitation_per_partner_driver/i);

    // Transition first invitation to REJECTED
    await prisma.driverInvitation.update({
      where: { id: inv1.id },
      data: { invitationStatus: 'REJECTED', respondedAt: new Date(), rejectionReason: 'Not interested' },
    });

    // Now a new PENDING invitation to the same mobile must succeed
    const inv2 = await prisma.driverInvitation.create({
      data: {
        partnerId: partner1ProfileId,
        invitedMobile: MOB_INVITED_1,
        driverName: 'Re-invited Driver',
        invitationToken: token2,
        invitationStatus: 'PENDING',
        expiresAt,
      },
    });
    expect(inv2.id).toBeDefined();
    expect(inv2.invitationStatus).toBe('PENDING');
  });

  // -------------------------------------------------------------
  // Test 3: Multiple owner affiliations for one driver
  // -------------------------------------------------------------
  test('3. Multiple owner affiliations: driver should be affiliated with multiple distinct owners simultaneously', async () => {
    // Affiliation with Partner 1
    const aff1 = await prisma.driverPartnerAffiliation.create({
      data: {
        driverId: driver1ProfileId,
        partnerId: partner1ProfileId,
        affiliationStatus: 'ACTIVE',
      },
    });
    expect(aff1.id).toBeDefined();

    // Affiliation with Partner 2
    const aff2 = await prisma.driverPartnerAffiliation.create({
      data: {
        driverId: driver1ProfileId,
        partnerId: partner2ProfileId,
        affiliationStatus: 'ACTIVE',
      },
    });
    expect(aff2.id).toBeDefined();

    // Verify both affiliations are active in the database
    const activeAffiliations = await prisma.driverPartnerAffiliation.findMany({
      where: { driverId: driver1ProfileId, affiliationStatus: 'ACTIVE' },
    });
    expect(activeAffiliations.length).toBe(2);

    // Second active affiliation with the SAME partner must fail (partial unique index)
    let thrownError: any = null;
    try {
      await prisma.driverPartnerAffiliation.create({
        data: {
          driverId: driver1ProfileId,
          partnerId: partner1ProfileId,
          affiliationStatus: 'ACTIVE',
        },
      });
    } catch (err: any) {
      thrownError = err;
    }
    expect(thrownError).not.toBeNull();
    expect(thrownError.message).toMatch(/unique|23505|idx_active_driver_partner_affiliation/i);
  });

  // -------------------------------------------------------------
  // Test 4: Historical affiliation preservation
  // -------------------------------------------------------------
  test('4. Historical affiliation preservation: terminated affiliation is preserved when re-affiliating', async () => {
    // 1. Terminate Driver 1 affiliation with Partner 2
    const affP2 = await prisma.driverPartnerAffiliation.findFirst({
      where: { driverId: driver1ProfileId, partnerId: partner2ProfileId, affiliationStatus: 'ACTIVE' },
    });
    expect(affP2).not.toBeNull();

    await prisma.driverPartnerAffiliation.update({
      where: { id: affP2!.id },
      data: {
        affiliationStatus: 'TERMINATED',
        terminatedAt: new Date(),
        terminationReason: 'Shift completed season contract',
      },
    });

    // 2. Re-affiliate Driver 1 with Partner 2
    const newAff = await prisma.driverPartnerAffiliation.create({
      data: {
        driverId: driver1ProfileId,
        partnerId: partner2ProfileId,
        affiliationStatus: 'ACTIVE',
      },
    });
    expect(newAff.id).toBeDefined();

    // 3. Verify total affiliation records count is 2 (1 TERMINATED + 1 ACTIVE)
    const allP2Affs = await prisma.driverPartnerAffiliation.findMany({
      where: { driverId: driver1ProfileId, partnerId: partner2ProfileId },
    });
    expect(allP2Affs.length).toBe(2);
    expect(allP2Affs.some((a) => a.affiliationStatus === 'TERMINATED')).toBe(true);
    expect(allP2Affs.some((a) => a.affiliationStatus === 'ACTIVE')).toBe(true);

    // 4. Test check constraint chk_active_affiliation_terminated_at:
    // Inserting ACTIVE affiliation with non-null terminatedAt must fail
    let thrownCheckError: any = null;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO public.driver_partner_affiliations (driver_id, partner_id, affiliation_status, terminated_at)
        VALUES (${driver2ProfileId}, ${partner2ProfileId}, 'ACTIVE', CURRENT_TIMESTAMP);
      `);
    } catch (err: any) {
      thrownCheckError = err;
    }
    expect(thrownCheckError).not.toBeNull();
    expect(thrownCheckError.message).toMatch(/chk_active_affiliation_terminated_at|23514/i);
  });

  // -------------------------------------------------------------
  // Test 5: Driver overlapping assignment rejection
  // -------------------------------------------------------------
  test('5. Driver overlapping assignments: PostgreSQL GiST exclusion constraint rejects overlapping driver shifts', async () => {
    const shift1Start = new Date('2026-11-10T10:00:00.000Z');
    const shift1End = new Date('2026-11-10T14:00:00.000Z');

    // Shift 1: Driver 1 on Vehicle 1 from 10:00 to 14:00
    const a1 = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver1ProfileId,
        vehicleId: vehicle1Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: shift1Start,
        endTime: shift1End,
      },
    });
    expect(a1.id).toBeDefined();

    // Shift 2: Overlapping shift for Driver 1 on Vehicle 2 from 12:00 to 16:00
    const shift2Start = new Date('2026-11-10T12:00:00.000Z');
    const shift2End = new Date('2026-11-10T16:00:00.000Z');

    let thrownOverlapError: any = null;
    try {
      await prisma.driverVehicleAssignment.create({
        data: {
          driverId: driver1ProfileId,
          vehicleId: vehicle2Id,
          partnerId: partner1ProfileId,
          assignmentStatus: 'SCHEDULED',
          startTime: shift2Start,
          endTime: shift2End,
        },
      });
    } catch (err: any) {
      thrownOverlapError = err;
    }

    expect(thrownOverlapError).not.toBeNull();
    // PostgreSQL error code 23P01 (exclusion_violation)
    expect(thrownOverlapError.message).toMatch(/ex_no_overlapping_driver_assignments|exclusion|23P01/i);
  });

  // -------------------------------------------------------------
  // Test 6: Vehicle overlapping assignment rejection
  // -------------------------------------------------------------
  test('6. Vehicle overlapping assignments: PostgreSQL GiST exclusion constraint rejects overlapping vehicle shifts', async () => {
    // Driver 2 on Vehicle 2: 10:00 to 14:00
    const shift1Start = new Date('2026-11-11T10:00:00.000Z');
    const shift1End = new Date('2026-11-11T14:00:00.000Z');

    const a1 = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver2ProfileId,
        vehicleId: vehicle2Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: shift1Start,
        endTime: shift1End,
      },
    });
    expect(a1.id).toBeDefined();

    // Different driver (Driver 1) attempting to be assigned to the SAME vehicle (Vehicle 2) at overlapping time: 13:00 to 17:00
    const shift2Start = new Date('2026-11-11T13:00:00.000Z');
    const shift2End = new Date('2026-11-11T17:00:00.000Z');

    let thrownOverlapError: any = null;
    try {
      await prisma.driverVehicleAssignment.create({
        data: {
          driverId: driver1ProfileId,
          vehicleId: vehicle2Id,
          partnerId: partner1ProfileId,
          assignmentStatus: 'SCHEDULED',
          startTime: shift2Start,
          endTime: shift2End,
        },
      });
    } catch (err: any) {
      thrownOverlapError = err;
    }

    expect(thrownOverlapError).not.toBeNull();
    // PostgreSQL exclusion constraint on vehicle
    expect(thrownOverlapError.message).toMatch(/ex_no_overlapping_vehicle_assignments|exclusion|23P01/i);
  });

  // -------------------------------------------------------------
  // Test 7: Adjacent non-overlapping shifts acceptance
  // -------------------------------------------------------------
  test('7. Adjacent shifts: half-open intervals [) permit adjacent back-to-back shifts without collision', async () => {
    // Shift 1: 08:00 to 12:00
    const shift1Start = new Date('2026-11-12T08:00:00.000Z');
    const shift1End = new Date('2026-11-12T12:00:00.000Z');

    const a1 = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver1ProfileId,
        vehicleId: vehicle1Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: shift1Start,
        endTime: shift1End,
      },
    });
    expect(a1.id).toBeDefined();

    // Shift 2 starts exactly at 12:00 (the end of Shift 1) to 16:00
    const shift2Start = new Date('2026-11-12T12:00:00.000Z');
    const shift2End = new Date('2026-11-12T16:00:00.000Z');

    // Both same driver on another vehicle AND same vehicle with another driver should succeed!
    // A: Same Driver 1 on Vehicle 2 starting right at 12:00
    const a2 = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver1ProfileId,
        vehicleId: vehicle2Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: shift2Start,
        endTime: shift2End,
      },
    });
    expect(a2.id).toBeDefined();

    // B: Vehicle 1 operated by Driver 2 starting right at 12:00
    const a3 = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver2ProfileId,
        vehicleId: vehicle1Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: shift2Start,
        endTime: shift2End,
      },
    });
    expect(a3.id).toBeDefined();
  });

  // -------------------------------------------------------------
  // Test 8: Open-ended active assignment overlap rejection
  // -------------------------------------------------------------
  test('8. Open-ended active assignments: assignment with null end_time blocks future assignments as infinity', async () => {
    const shiftStart = new Date('2026-11-13T06:00:00.000Z');

    // Driver 1 on Vehicle 1 with indefinite/active shift (endTime is null)
    const openEnded = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver1ProfileId,
        vehicleId: vehicle1Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'ACTIVE',
        startTime: shiftStart,
        endTime: null, // treated as infinity by exclusion constraint
      },
    });
    expect(openEnded.id).toBeDefined();

    // Attempt to schedule Driver 1 on any vehicle at a later time
    const laterStart = new Date('2026-11-13T18:00:00.000Z');
    const laterEnd = new Date('2026-11-13T22:00:00.000Z');

    let thrownDriverError: any = null;
    try {
      await prisma.driverVehicleAssignment.create({
        data: {
          driverId: driver1ProfileId,
          vehicleId: vehicle2Id,
          partnerId: partner1ProfileId,
          assignmentStatus: 'SCHEDULED',
          startTime: laterStart,
          endTime: laterEnd,
        },
      });
    } catch (err: any) {
      thrownDriverError = err;
    }
    expect(thrownDriverError).not.toBeNull();
    expect(thrownDriverError.message).toMatch(/ex_no_overlapping_driver_assignments|exclusion|23P01/i);

    // Attempt to schedule another driver on Vehicle 1 at a later time
    let thrownVehicleError: any = null;
    try {
      await prisma.driverVehicleAssignment.create({
        data: {
          driverId: driver2ProfileId,
          vehicleId: vehicle1Id,
          partnerId: partner1ProfileId,
          assignmentStatus: 'SCHEDULED',
          startTime: laterStart,
          endTime: laterEnd,
        },
      });
    } catch (err: any) {
      thrownVehicleError = err;
    }
    expect(thrownVehicleError).not.toBeNull();
    expect(thrownVehicleError.message).toMatch(/ex_no_overlapping_vehicle_assignments|exclusion|23P01/i);

    // Close the open-ended shift
    await prisma.driverVehicleAssignment.update({
      where: { id: openEnded.id },
      data: { assignmentStatus: 'COMPLETED', endTime: new Date('2026-11-13T14:00:00.000Z') },
    });
  });

  // -------------------------------------------------------------
  // Test 9: Invalid time range rejection
  // -------------------------------------------------------------
  test('9. Invalid time range & invalid status rejection by CHECK constraints', async () => {
    // A: end_time before start_time
    let thrownTimeRangeError: any = null;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO public.driver_vehicle_assignments (
          driver_id, vehicle_id, partner_id, assignment_status, start_time, end_time
        ) VALUES (
          ${driver1ProfileId}, ${vehicle1Id}, ${partner1ProfileId}, 'SCHEDULED',
          '2026-11-14T16:00:00.000Z'::timestamptz, '2026-11-14T10:00:00.000Z'::timestamptz
        );
      `);
    } catch (err: any) {
      thrownTimeRangeError = err;
    }
    expect(thrownTimeRangeError).not.toBeNull();
    expect(thrownTimeRangeError.message).toMatch(/chk_dva_time_range|23514/i);

    // B: invalid assignment status
    let thrownStatusError: any = null;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO public.driver_vehicle_assignments (
          driver_id, vehicle_id, partner_id, assignment_status, start_time, end_time
        ) VALUES (
          ${driver1ProfileId}, ${vehicle1Id}, ${partner1ProfileId}, 'UNAUTHORIZED_STATUS',
          '2026-11-14T10:00:00.000Z'::timestamptz, '2026-11-14T14:00:00.000Z'::timestamptz
        );
      `);
    } catch (err: any) {
      thrownStatusError = err;
    }
    expect(thrownStatusError).not.toBeNull();
    expect(thrownStatusError.message).toMatch(/chk_dva_status|23514/i);
  });

  // -------------------------------------------------------------
  // Test 10: Historical completed/cancelled assignments preservation
  // -------------------------------------------------------------
  test('10. Historical preservation: COMPLETED and CANCELLED assignments do not collide and remain fully preserved', async () => {
    const historicalTimeStart = new Date('2026-11-15T09:00:00.000Z');
    const historicalTimeEnd = new Date('2026-11-15T17:00:00.000Z');

    // 1. Insert COMPLETED assignment
    const completed = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver1ProfileId,
        vehicleId: vehicle1Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'COMPLETED',
        startTime: historicalTimeStart,
        endTime: historicalTimeEnd,
      },
    });
    expect(completed.id).toBeDefined();

    // 2. Insert CANCELLED assignment covering the exact same time window
    const cancelled = await prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver1ProfileId,
        vehicleId: vehicle1Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'CANCELLED',
        startTime: historicalTimeStart,
        endTime: historicalTimeEnd,
        cancellationReason: 'Driver illness',
      },
    });
    expect(cancelled.id).toBeDefined();

    // 3. Both exist in database
    const history = await prisma.driverVehicleAssignment.findMany({
      where: {
        driverId: driver1ProfileId,
        vehicleId: vehicle1Id,
        startTime: historicalTimeStart,
      },
    });
    expect(history.length).toBe(2);
    expect(history.some((h) => h.assignmentStatus === 'COMPLETED')).toBe(true);
    expect(history.some((h) => h.assignmentStatus === 'CANCELLED')).toBe(true);
  });

  // -------------------------------------------------------------
  // Test 11: Foreign-key and delete behavior
  // -------------------------------------------------------------
  test('11. Referential integrity: RESTRICT prevents accidental cascade deletion of driver documents', async () => {
    // 1. Create a driver document
    const doc = await prisma.driverDocument.create({
      data: {
        driverId: driver2ProfileId,
        documentType: 'DRIVING_LICENCE',
        documentStorageKey: 'drivers/docs/dl_test_123.pdf',
        verificationStatus: 'PENDING',
      },
    });
    expect(doc.id).toBeDefined();

    // 2. Attempt to delete the driver profile -> MUST be rejected because fk_driver_document_driver has ON DELETE RESTRICT
    let thrownDeleteError: any = null;
    try {
      await prisma.driverProfile.delete({
        where: { id: driver2ProfileId },
      });
    } catch (err: any) {
      thrownDeleteError = err;
    }

    expect(thrownDeleteError).not.toBeNull();
    // Foreign key violation 23503 prevents cascade deletion
    expect(thrownDeleteError.message).toMatch(/foreign key|23503|fk_driver_document_driver/i);

    // 3. Attempt to insert driver document with non-existent driverId -> MUST fail
    let thrownInsertError: any = null;
    try {
      await prisma.driverDocument.create({
        data: {
          driverId: BigInt(999999999),
          documentType: 'IDENTITY_PROOF',
          documentStorageKey: 'drivers/docs/id_test.pdf',
        },
      });
    } catch (err: any) {
      thrownInsertError = err;
    }
    expect(thrownInsertError).not.toBeNull();
    expect(thrownInsertError.message).toMatch(/foreign key|23503/i);
  });

  // -------------------------------------------------------------
  // Test 12: Concurrent assignment insert protection
  // -------------------------------------------------------------
  test('12. Concurrency: simultaneous overlapping assignment attempts must allow exactly one and reject the other with 23P01', async () => {
    const concurrentStart = new Date('2026-11-16T10:00:00.000Z');
    const concurrentEnd = new Date('2026-11-16T18:00:00.000Z');

    // Run two simultaneous attempts to assign Driver 2 to Vehicle 1 and Vehicle 2 for the exact same shift
    const attempt1 = prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver2ProfileId,
        vehicleId: vehicle1Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: concurrentStart,
        endTime: concurrentEnd,
      },
    });

    const attempt2 = prisma.driverVehicleAssignment.create({
      data: {
        driverId: driver2ProfileId,
        vehicleId: vehicle2Id,
        partnerId: partner1ProfileId,
        assignmentStatus: 'SCHEDULED',
        startTime: concurrentStart,
        endTime: concurrentEnd,
      },
    });

    const results = await Promise.allSettled([attempt1, attempt2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, and exactly one must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const failureReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(failureReason.message).toMatch(/ex_no_overlapping_driver_assignments|exclusion|23P01/i);
  });
});

